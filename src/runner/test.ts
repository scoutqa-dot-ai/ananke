import { relative } from "node:path";
import { createClient } from "../client/index.js";
import type { ProtocolClient } from "../client/types.js";
import {
  interpolate,
  interpolateObject,
  type Variables,
} from "../config/interpolate.js";
import type {
  ProjectConfig,
  TestFile,
  TestData,
  TurnData,
} from "../types/index.js";
import { isUserStep, isConnectStep, isScriptStep } from "../types/test.js";
import { executeTurn, executeConnectTurn, collectTurnData, withPromptSent } from "./turn.js";
import {
  executeScript,
  normalizeScriptConfig,
  buildAnankeInput,
  mergeVariables,
} from "./script.js";
import { mergeAssertBlocks } from "./merge.js";
import { formatDuration } from "./format.js";
import {
  evaluateTurnAssertions,
  evaluateTestAssertions,
  validateNamedAssertions,
  type AssertionResult,
  type NamedAssertions,
  type EvaluationOptions,
} from "../assertions/index.js";
import {
  getTestRecordingDir,
  createRecordingGenerator,
  recordScriptStepOutput,
  replayEvents,
  loadScriptStepOutput,
} from "../recording/index.js";
import type { Logger } from "../logger.js";

export interface TestRunnerOptions {
  config: ProjectConfig;
  test: TestFile;
  testFilePath: string;
  logger: Logger;
  recordDir?: string;
  replayDir?: string;
}

export interface TestResult {
  testName: string;
  passed: boolean;
  skipped?: boolean;
  testData: TestData;
  error?: string;
  failures: string[];
}

/**
 * Run a single test file
 */
export async function runTest(options: TestRunnerOptions): Promise<TestResult> {
  const { config, test, testFilePath, logger, recordDir, replayDir } = options;

  const startTs = Date.now();
  const turns: TurnData[] = [];
  const failures: string[] = [];

  // Validate and prepare named assertions from config
  const namedAssertions: NamedAssertions = config.assertions ?? {};
  if (Object.keys(namedAssertions).length > 0) {
    validateNamedAssertions(namedAssertions);
  }

  // Mutable variable map — accumulated throughout test execution
  const variables: Variables = {};

  // Get recording directory for this test (use relative path)
  const relativeTestPath = relative(process.cwd(), testFilePath);
  const testRecordingDir = recordDir ? getTestRecordingDir(recordDir, relativeTestPath) : undefined;
  const testReplayDir = replayDir ? getTestRecordingDir(replayDir, relativeTestPath) : undefined;

  if (testReplayDir) {
    logger.trace(`[Replay] Loading from: ${testReplayDir}`);
  } else if (testRecordingDir) {
    logger.trace(`[Record] Saving to: ${testRecordingDir}`);
  }

  // Interpolate config with variables will happen after script steps set vars
  // but we need it before creating the client. We'll re-interpolate as needed.
  let interpolatedConfig = interpolateObject(
    excludeAssertions(config),
    variables
  ) as ProjectConfig;

  // Create client (only needed for non-replay mode, deferred until first agent step)
  let client: ProtocolClient | undefined;

  // Track turn index separately (only agent-facing steps increment it)
  let turnIndex = 0;

  // Execute steps
  for (let i = 0; i < test.steps.length; i++) {
    const step = test.steps[i];

    try {
      if (isScriptStep(step)) {
        // Script step — run script, set variables, no message to agent
        logger.debug(`  Step ${i + 1}: [script]`);

        if (testReplayDir) {
          // Replay mode: load script output from recording
          const scriptOutput = await loadScriptStepOutput(replayDir!, relativeTestPath, i);
          if (scriptOutput) {
            if (scriptOutput.skipped) {
              logger.debug("  Script step skipped test (replay)");
              return {
                testName: test.name,
                passed: true,
                skipped: true,
                testData: buildTestData(turns, startTs),
                failures: [],
              };
            }
            mergeVariables(variables, scriptOutput.variables ?? {}, "script step (replay)", logger);
          }
        } else {
          // Normal/record mode: execute script
          const scriptConfig = normalizeScriptConfig(step.script);
          const ananke = buildAnankeInput({
            turns,
            variables,
            turnIndex: null,
          });

          const scriptResult = await executeScript(scriptConfig, ananke, { logger });

          if (scriptResult.exitCode !== 0) {
            // Non-zero exit = skip test (precondition not met)
            logger.debug(`  Script step skipped test: ${scriptResult.stderr}`);
            if (testRecordingDir) {
              await recordScriptStepOutput(testRecordingDir, i, {
                variables: {},
                skipped: true,
              });
            }
            return {
              testName: test.name,
              passed: true,
              skipped: true,
              testData: buildTestData(turns, startTs),
              failures: [],
            };
          }

          const { output } = scriptResult;

          // Merge variables
          mergeVariables(variables, output.variables, "script step", logger);

          // Record script step output
          if (testRecordingDir) {
            await recordScriptStepOutput(testRecordingDir, i, {
              variables: output.variables,
            });
          }
        }

        const varKeys = Object.keys(variables);
        if (varKeys.length > 0) {
          logger.debug(`  Variables: ${varKeys.join(', ')}`);
        }

        // Re-interpolate config after new variables
        interpolatedConfig = interpolateObject(
          excludeAssertions(config),
          variables
        ) as ProjectConfig;

        continue; // Script steps don't produce TurnData
      }

      // Agent-facing steps below — ensure client exists
      if (!client && !testReplayDir) {
        client = createClient(interpolatedConfig, { logger });
      }

      let turnData: TurnData;

      if (testReplayDir) {
        // Replay mode
        if (isConnectStep(step)) {
          logger.debug(`  Step ${i + 1}: [connect] (replay)`);
        } else if (isUserStep(step)) {
          const userMessage = interpolate(step.user, variables);
          logger.debug(`  Step ${i + 1}: "${userMessage.slice(0, 50)}${userMessage.length > 50 ? '...' : ''}" (replay)`);
        }
        const events = replayEvents(replayDir!, relativeTestPath, turnIndex);
        turnData = await collectTurnData(events, turnIndex, { logger });
      } else if (isConnectStep(step)) {
        // Connect step - no message, just observe
        logger.debug(`  Step ${i + 1}: [connect]`);
        if (!client!.connect) {
          throw new Error("Client does not support connect operation");
        }
        if (testRecordingDir) {
          const events = createRecordingGenerator(withPromptSent(client!.connect()), testRecordingDir, turnIndex);
          turnData = await collectTurnData(events, turnIndex, { logger });
        } else {
          turnData = await executeConnectTurn(client!, turnIndex, { logger });
        }
      } else if (isUserStep(step)) {
        // User message step
        const userMessage = interpolate(step.user, variables);
        logger.debug(`  Step ${i + 1}: "${userMessage.slice(0, 50)}${userMessage.length > 50 ? '...' : ''}"`);
        if (testRecordingDir) {
          const events = createRecordingGenerator(withPromptSent(client!.sendMessage({ message: userMessage })), testRecordingDir, turnIndex);
          turnData = await collectTurnData(events, turnIndex, { logger });
        } else {
          turnData = await executeTurn(client!, userMessage, turnIndex, { logger });
        }
      } else {
        throw new Error(`Unknown step type at index ${i}`);
      }

      turns.push(turnData);

      logger.debug(`    Tools: ${turnData.toolCalls.map((t) => t.name).join(', ') || '(none)'}`);
      logger.debug(`    Duration: ${formatDuration(turnData.endTs - turnData.startTs)}`);

      // Evaluate turn-level assertions (merged: target -> test -> step)
      const turnAssertions = mergeAssertBlocks(
        interpolatedConfig.target.assert,
        test.assert,
        step.assert
      );
      const hasAssertions = Object.keys(turnAssertions).length > 0;

      if (hasAssertions) {
        const evalOptions: EvaluationOptions = {
          namedAssertions,
          logger,
          variables,
          turns,
          turnIndex,
        };
        const evalResult = await evaluateTurnAssertions(turnData, turnAssertions, evalOptions);

        if (!evalResult.passed) {
          for (const failure of evalResult.failures) {
            failures.push(formatFailure(failure, turnIndex + 1));
          }
          // Fail fast on turn-level assertion failure
          return {
            testName: test.name,
            passed: false,
            testData: buildTestData(turns, startTs),
            failures,
          };
        }
      }

      turnIndex++;
    } catch (err) {
      return {
        testName: test.name,
        passed: false,
        testData: buildTestData(turns, startTs),
        error: `Step ${i + 1} failed: ${(err as Error).message}`,
        failures: [],
      };
    }
  }

  // Evaluate test-level assertions (merged: target -> test)
  const testData = buildTestData(turns, startTs);
  const testAssertions = mergeAssertBlocks(
    interpolatedConfig.target.assert,
    test.assert,
    undefined
  );
  const hasTestAssertions = Object.keys(testAssertions).length > 0;

  if (hasTestAssertions) {
    const evalOptions: EvaluationOptions = {
      namedAssertions,
      logger,
      variables,
      turns,
      turnIndex: null,
    };
    const evalResult = await evaluateTestAssertions(testData, testAssertions, evalOptions);

    if (!evalResult.passed) {
      for (const failure of evalResult.failures) {
        failures.push(formatFailure(failure));
      }
    }
  }

  return {
    testName: test.name,
    passed: failures.length === 0,
    testData,
    failures,
  };
}

/**
 * Exclude assertions from config for interpolation
 * (assertions contain ${param} templates resolved later by the assertion resolver)
 */
function excludeAssertions(config: ProjectConfig): Record<string, unknown> {
  const { assertions: _skipAssertions, ...rest } = config as Record<string, unknown>;
  return rest;
}

function buildTestData(turns: TurnData[], startTs: number): TestData {
  const allToolCalls = turns.flatMap((t) => t.toolCalls);
  const allAssistantTexts = turns.map((t) => t.assistantText);

  return {
    turns,
    allToolCalls,
    allAssistantTexts,
    startTs,
    endTs: Date.now(),
  };
}

function formatFailure(failure: AssertionResult, turnIndex?: number, indent = 0): string {
  const pad = indent > 0 ? '  '.repeat(indent) : '';
  const prefix = turnIndex !== undefined && indent === 0 ? `[Turn ${turnIndex}] ` : '';
  const pathStr = failure.path?.length ? `${failure.path.join(' → ')}: ` : '';
  const lastSegment = failure.path?.[failure.path.length - 1];
  const assertionLabel = lastSegment === failure.assertion ? '' : failure.assertion;
  let msg = `${pad}${prefix}${pathStr}${assertionLabel}`;
  if (failure.expected) {
    msg += ` (expected: ${failure.expected}`;
    if (failure.actual) {
      msg += `, got: ${failure.actual}`;
    }
    msg += ')';
  } else if (failure.actual) {
    msg += ` (got: ${failure.actual})`;
  }
  if (failure.details) {
    msg += ` - ${failure.details}`;
  }
  if (failure.children?.length) {
    for (const child of failure.children) {
      msg += '\n' + formatFailure(child, undefined, indent + 1);
    }
  }
  return msg;
}
