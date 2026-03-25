import { relative } from "node:path";
import { createClient } from "../client/index.js";
import type { ProtocolClient } from "../client/types.js";
import { executeHook } from "../hooks/index.js";
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
import { isUserTurn, isConnectTurn, isScriptTurn } from "../types/test.js";
import { executeTurn, executeConnectTurn, collectTurnData } from "./turn.js";
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
  recordHookOutput,
  recordScriptTurnOutput,
  replayEvents,
  loadHookOutput,
  loadScriptTurnOutput,
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

  // Execute hooks and collect variables
  if (test.hooks && test.hooks.length > 0) {
    if (replayDir) {
      // Replay mode: load hook outputs from files
      logger.debug('  Loading hooks from recording...');
      for (let i = 0; i < test.hooks.length; i++) {
        const hookVars = await loadHookOutput(replayDir, relativeTestPath, i);
        if (hookVars) {
          mergeVariables(variables, hookVars, `hook ${i + 1} (replay)`, logger);
        }
      }
      const varKeys = Object.keys(variables);
      if (varKeys.length > 0) {
        logger.debug(`  Variables: ${varKeys.join(', ')}`);
      }
    } else {
      // Normal/record mode: execute hooks
      logger.debug('  Executing hooks...');
      try {
        for (let i = 0; i < test.hooks.length; i++) {
          const result = await executeHook(test.hooks[i], { currentVars: variables, logger });

          // Handle skip actions
          if (result.action === 'skip_test') {
            logger.debug('  Hook requested skip_test');
            return {
              testName: test.name,
              passed: true,
              skipped: true,
              testData: buildTestData(turns, startTs),
              failures: [],
            };
          }

          if (result.action === 'skip_hook') {
            logger.debug(`  Hook ${i + 1} skipped`);
            continue;
          }

          mergeVariables(variables, result.variables, `hook ${i + 1}`, logger);

          // Record hook output if recording
          if (testRecordingDir) {
            await recordHookOutput(testRecordingDir, i, result.variables);
          }
        }
        const varKeys = Object.keys(variables);
        if (varKeys.length > 0) {
          logger.debug(`  Variables: ${varKeys.join(', ')}`);
        }
      } catch (err) {
        return {
          testName: test.name,
          passed: false,
          testData: buildTestData(turns, startTs),
          error: `Hook failed: ${(err as Error).message}`,
          failures: [`Hook failed: ${(err as Error).message}`],
        };
      }
    }
  }

  // Interpolate config with variables (exclude assertions — they contain
  // ${param} templates resolved later by the assertion resolver, not here)
  const { assertions: _skipAssertions, ...configWithoutAssertions } = config as Record<string, unknown>;
  const interpolatedConfig = interpolateObject(configWithoutAssertions, variables) as ProjectConfig;

  // Create client (only needed for non-replay mode)
  const client: ProtocolClient | undefined = testReplayDir
    ? undefined
    : createClient(interpolatedConfig, { logger });

  // Execute turns
  for (let i = 0; i < test.turns.length; i++) {
    const turn = test.turns[i];

    try {
      let turnData: TurnData;

      if (testReplayDir) {
        // Replay mode: load events from file
        if (isScriptTurn(turn)) {
          // Restore script turn output (variables, action) from recording
          logger.debug(`  Turn ${i + 1}: [script] (replay)`);
          const scriptOutput = await loadScriptTurnOutput(replayDir!, relativeTestPath, i);
          if (scriptOutput) {
            if (scriptOutput.action === "skip_test") {
              return {
                testName: test.name,
                passed: true,
                skipped: true,
                testData: buildTestData(turns, startTs),
                failures: [],
              };
            }
            if (scriptOutput.action === "skip_turn") {
              mergeVariables(variables, scriptOutput.variables ?? {}, "script turn (replay)", logger);
              continue;
            }
            mergeVariables(variables, scriptOutput.variables ?? {}, "script turn (replay)", logger);
          }
        } else if (isConnectTurn(turn)) {
          logger.debug(`  Turn ${i + 1}: [connect] (replay)`);
        } else if (isUserTurn(turn)) {
          const userMessage = interpolate(turn.user, variables);
          logger.debug(`  Turn ${i + 1}: "${userMessage.slice(0, 50)}${userMessage.length > 50 ? '...' : ''}" (replay)`);
        }
        const events = replayEvents(replayDir!, relativeTestPath, i);
        turnData = await collectTurnData(events, i, { logger });
      } else if (isScriptTurn(turn)) {
        // Script turn — execute script to get message
        logger.debug(`  Turn ${i + 1}: [script]`);
        const scriptConfig = normalizeScriptConfig(turn.script);
        const ananke = buildAnankeInput({
          turns,
          variables,
          turnIndex: i,
        });

        const scriptResult = await executeScript(scriptConfig, ananke, "turn", { logger });

        if (scriptResult.exitCode !== 0) {
          throw new Error(`Script turn failed: ${scriptResult.stderr}`);
        }

        const { output } = scriptResult;

        // Handle skip actions
        if (output.action === "skip_test") {
          logger.debug("  Script turn requested skip_test");
          if (testRecordingDir) {
            await recordScriptTurnOutput(testRecordingDir, i, {
              variables: output.variables,
              action: "skip_test",
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

        if (output.action === "skip_turn") {
          logger.debug("  Script turn skipped (skip_turn)");
          if (testRecordingDir) {
            await recordScriptTurnOutput(testRecordingDir, i, {
              variables: output.variables,
              action: "skip_turn",
            });
          }
          // Merge any variables the script set before skipping
          mergeVariables(variables, output.variables, "script turn", logger);
          continue;
        }

        // Require message field
        if (!output.message || !output.message.trim()) {
          throw new Error(
            `Script turn did not produce a "message" field`
          );
        }

        // Merge variables before sending message
        mergeVariables(variables, output.variables, "script turn", logger);

        // Record script turn output for replay
        if (testRecordingDir) {
          await recordScriptTurnOutput(testRecordingDir, i, {
            variables: output.variables,
            message: output.message,
          });
        }

        const userMessage = output.message;
        logger.debug(`    Message: "${userMessage.slice(0, 50)}${userMessage.length > 50 ? '...' : ''}"`);

        if (testRecordingDir) {
          const events = createRecordingGenerator(client!.sendMessage({ message: userMessage }), testRecordingDir, i);
          turnData = await collectTurnData(events, i, { logger });
        } else {
          turnData = await executeTurn(client!, userMessage, i, { logger });
        }
      } else if (isConnectTurn(turn)) {
        // Connect turn - no message, just observe
        logger.debug(`  Turn ${i + 1}: [connect]`);
        if (!client!.connect) {
          throw new Error("Client does not support connect operation");
        }
        if (testRecordingDir) {
          const events = createRecordingGenerator(client!.connect(), testRecordingDir, i);
          turnData = await collectTurnData(events, i, { logger });
        } else {
          turnData = await executeConnectTurn(client!, i, { logger });
        }
      } else if (isUserTurn(turn)) {
        // User message turn
        const userMessage = interpolate(turn.user, variables);
        logger.debug(`  Turn ${i + 1}: "${userMessage.slice(0, 50)}${userMessage.length > 50 ? '...' : ''}"`);
        if (testRecordingDir) {
          const events = createRecordingGenerator(client!.sendMessage({ message: userMessage }), testRecordingDir, i);
          turnData = await collectTurnData(events, i, { logger });
        } else {
          turnData = await executeTurn(client!, userMessage, i, { logger });
        }
      } else {
        // Should never happen due to Zod validation
        throw new Error(`Unknown turn type at index ${i}`);
      }

      turns.push(turnData);

      logger.debug(`    Tools: ${turnData.toolCalls.map((t) => t.name).join(', ') || '(none)'}`);
      logger.debug(`    Duration: ${formatDuration(turnData.endTs - turnData.startTs)}`);

      // Evaluate turn-level assertions (merged: target -> test -> turn)
      const turnAssertions = mergeAssertBlocks(
        interpolatedConfig.target.assert,
        test.assert,
        turn.assert
      );
      const hasAssertions = Object.keys(turnAssertions).length > 0;

      if (hasAssertions) {
        const evalOptions: EvaluationOptions = {
          namedAssertions,
          logger,
          variables,
          turns,
          turnIndex: i,
        };
        const evalResult = await evaluateTurnAssertions(turnData, turnAssertions, evalOptions);

        // Check for skip_test action from assertion scripts
        const skipTestResult = evalResult.results.find(
          (r) => r.details === "skip_test"
        );
        if (skipTestResult) {
          logger.debug("  Assertion script requested skip_test");
          return {
            testName: test.name,
            passed: true,
            skipped: true,
            testData: buildTestData(turns, startTs),
            failures: [],
          };
        }

        if (!evalResult.passed) {
          for (const failure of evalResult.failures) {
            failures.push(formatFailure(failure, i + 1));
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
    } catch (err) {
      return {
        testName: test.name,
        passed: false,
        testData: buildTestData(turns, startTs),
        error: `Turn ${i + 1} failed: ${(err as Error).message}`,
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

    // Check for skip_test from test-level assertion scripts
    const skipTestResult = evalResult.results.find(
      (r) => r.details === "skip_test"
    );
    if (skipTestResult) {
      logger.debug("  Test-level assertion script requested skip_test");
      return {
        testName: test.name,
        passed: true,
        skipped: true,
        testData,
        failures: [],
      };
    }

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

function formatFailure(failure: AssertionResult, turnIndex?: number): string {
  const prefix = turnIndex !== undefined ? `[Turn ${turnIndex}] ` : '';
  const pathStr = failure.path?.length ? `${failure.path.join(' → ')}: ` : '';
  let msg = `${prefix}${pathStr}${failure.assertion}`;
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
  return msg;
}

