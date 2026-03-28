import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { relative, join } from "node:path";
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
  StepData,
} from "../types/index.js";
import { isMessageStep, isResumeStep, isScriptStep, type Step } from "../types/test.js";
import { executeMessageStep, executeResumeStep, collectStepData, withPromptSent } from "./step.js";
import {
  executeScript,
  normalizeScriptConfig,
  buildAnankeInput,
  mergeVariables,
} from "./script.js";
import { formatDuration } from "./format.js";
import {
  evaluateStepAssertions,
  validateNamedAssertions,
  type AssertionResult,
  type NamedAssertions,
  type EvaluationOptions,
} from "../assertions/index.js";
import {
  getTestRecordingDir,
  createRecordingGenerator,
  replayEvents,
} from "../recording/index.js";
import type { Logger } from "../logger.js";

export interface TestRunnerOptions {
  config: ProjectConfig;
  test: TestFile;
  testFilePath: string;
  logger: Logger;
  reportDir?: string;
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
 * Build a StepInput from a step definition, stripping expect.
 */
function buildStepInput(step: Step, overrides?: Record<string, unknown>): Record<string, unknown> {
  const { expect: _expect, ...rest } = step as Record<string, unknown>;
  return { ...rest, ...overrides };
}

/**
 * Run a single test file
 */
export async function runTest(options: TestRunnerOptions): Promise<TestResult> {
  const { config, test, testFilePath, logger, reportDir, replayDir } = options;

  const startTs = Date.now();
  const steps: StepData[] = [];
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
  const testRecordingDir = reportDir ? getTestRecordingDir(reportDir, relativeTestPath) : undefined;
  const testReplayDir = replayDir ? getTestRecordingDir(replayDir, relativeTestPath) : undefined;

  if (testReplayDir) {
    logger.trace(`[Replay] Loading from: ${testReplayDir}`);
  } else if (testRecordingDir) {
    logger.trace(`[Report] Saving to: ${testRecordingDir}`);
  }

  // Interpolate config with variables will happen after script steps set vars
  // but we need it before creating the client. We'll re-interpolate as needed.
  let interpolatedConfig = interpolateObject(
    excludeAssertions(config),
    variables
  ) as ProjectConfig;

  // Create client (only needed for non-replay mode, deferred until first agent step)
  let client: ProtocolClient | undefined;

  // Track step index separately (only agent-facing steps increment it)
  let stepIndex = 0;

  /**
   * Ensure a client exists, creating one if needed.
   * Reads THREAD_ID from variables, generating one if absent.
   */
  function ensureClient(): void {
    if (client || testReplayDir) return;
    if (!variables.THREAD_ID) {
      variables.THREAD_ID = randomUUID();
      logger.debug(`  Generated THREAD_ID: ${variables.THREAD_ID}`);
    }
    client = createClient(interpolatedConfig, { threadId: variables.THREAD_ID, logger });
  }

  // Execute steps
  for (let i = 0; i < test.steps.length; i++) {
    const step = test.steps[i];

    try {
      if (isScriptStep(step)) {
        // Script step — always execute (even during replay)
        logger.debug(`  Step ${i + 1}: [script]`);

        const scriptStartTs = Date.now();
        const scriptConfig = normalizeScriptConfig(step.script);
        const ananke = buildAnankeInput({
          steps,
          variables,
          stepIndex: null,
        });

        const scriptResult = await executeScript(scriptConfig, ananke, { logger });
        const scriptEndTs = Date.now();

        if (scriptResult.exitCode !== 0) {
          // Non-zero exit = skip test (precondition not met)
          logger.debug(`  Script step skipped test: ${scriptResult.stderr}`);

          const scriptStepData: StepData = {
            stepIndex: i,
            input: buildStepInput(step),
            toolCalls: [],
            assistantText: "",
            startTs: scriptStartTs,
            endTs: scriptEndTs,
            timings: { ttfEventMs: null, ttfToolMs: null, ttfTextMs: null },
            exitCode: scriptResult.exitCode,
          };
          steps.push(scriptStepData);

          return {
            testName: test.name,
            passed: true,
            skipped: true,
            testData: buildTestData(steps, startTs),
            failures: [],
          };
        }

        mergeVariables(variables, scriptResult.output.variables, "script step", logger);

        const varKeys = Object.keys(variables);
        if (varKeys.length > 0) {
          logger.debug(`  Variables: ${varKeys.join(', ')}`);
        }

        // Re-interpolate config after new variables
        interpolatedConfig = interpolateObject(
          excludeAssertions(config),
          variables
        ) as ProjectConfig;

        const scriptStepData: StepData = {
          stepIndex: i,
          input: buildStepInput(step),
          toolCalls: [],
          assistantText: "",
          startTs: scriptStartTs,
          endTs: scriptEndTs,
          timings: { ttfEventMs: null, ttfToolMs: null, ttfTextMs: null },
          exitCode: scriptResult.exitCode,
        };
        steps.push(scriptStepData);

        continue; // Script steps don't go through agent flow below
      }

      if (isResumeStep(step)) {
        // Resume step — set thread ID, destroy old client, create new one
        const threadId = interpolate(step.resume, variables);
        logger.debug(`  Step ${i + 1}: [resume: ${threadId}]`);
        variables.THREAD_ID = threadId;
        client = undefined; // Force new client creation
      }

      // Agent-facing steps below — ensure client exists
      ensureClient();

      let stepData: StepData;

      if (testReplayDir) {
        // Replay mode
        let stepInput;
        if (isResumeStep(step)) {
          logger.debug(`  Step ${i + 1}: [resume] (replay)`);
          stepInput = buildStepInput(step, { resume: interpolate(step.resume, variables) });
        } else if (isMessageStep(step)) {
          const userMessage = interpolate(step.message, variables);
          logger.debug(`  Step ${i + 1}: "${userMessage.slice(0, 50)}${userMessage.length > 50 ? '...' : ''}" (replay)`);
          stepInput = buildStepInput(step, { message: userMessage });
        } else {
          throw new Error(`Unknown step type at index ${i}`);
        }
        const events = replayEvents(replayDir!, relativeTestPath, stepIndex);
        stepData = await collectStepData(events, stepIndex, stepInput, { logger });
      } else if (isResumeStep(step)) {
        // Resume step - no message, just observe
        if (!client!.resume) {
          throw new Error("Client does not support connect operation");
        }
        const stepInput = buildStepInput(step, { resume: interpolate(step.resume, variables) });
        if (testRecordingDir) {
          const events = createRecordingGenerator(withPromptSent(client!.resume()), testRecordingDir, stepIndex);
          stepData = await collectStepData(events, stepIndex, stepInput, { logger });
        } else {
          stepData = await executeResumeStep(client!, stepIndex, stepInput, { logger });
        }
      } else if (isMessageStep(step)) {
        // Message step
        const userMessage = interpolate(step.message, variables);
        logger.debug(`  Step ${i + 1}: "${userMessage.slice(0, 50)}${userMessage.length > 50 ? '...' : ''}"`);
        const stepInput = buildStepInput(step, { message: userMessage });
        if (testRecordingDir) {
          const events = createRecordingGenerator(withPromptSent(client!.message(userMessage)), testRecordingDir, stepIndex);
          stepData = await collectStepData(events, stepIndex, stepInput, { logger });
        } else {
          stepData = await executeMessageStep(client!, userMessage, stepIndex, stepInput, { logger });
        }
      } else {
        throw new Error(`Unknown step type at index ${i}`);
      }

      steps.push(stepData);

      logger.debug(`    Tools: ${stepData.toolCalls.map((t) => t.name).join(', ') || '(none)'}`);
      logger.debug(`    Duration: ${formatDuration(stepData.endTs - stepData.startTs)}`);

      // Evaluate step-level assertions
      const stepExpect = step.expect;
      const hasAssertions = stepExpect !== undefined && Object.keys(stepExpect).length > 0;

      if (hasAssertions) {
        const evalOptions: EvaluationOptions = {
          namedAssertions,
          logger,
          variables,
          steps,
          stepIndex,
        };
        const evalResult = await evaluateStepAssertions(stepData, stepExpect!, evalOptions);

        // Store assertion results on the step data
        stepData.assertions = {
          passed: evalResult.passed,
          results: evalResult.results,
          failures: evalResult.failures,
        };

        if (!evalResult.passed) {
          for (const failure of evalResult.failures) {
            failures.push(formatFailure(failure, stepIndex + 1));
          }
          // Fail fast on step-level assertion failure
          return {
            testName: test.name,
            passed: false,
            testData: buildTestData(steps, startTs),
            failures,
          };
        }
      }

      stepIndex++;
    } catch (err) {
      return {
        testName: test.name,
        passed: false,
        testData: buildTestData(steps, startTs),
        error: `Step ${i + 1} failed: ${(err as Error).message}`,
        failures: [],
      };
    }
  }

  return {
    testName: test.name,
    passed: failures.length === 0,
    testData: buildTestData(steps, startTs),
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

function buildTestData(steps: StepData[], startTs: number): TestData {
  const allToolCalls = steps.flatMap((t) => t.toolCalls);
  const allAssistantTexts = steps.map((t) => t.assistantText);

  return {
    steps,
    allToolCalls,
    allAssistantTexts,
    startTs,
    endTs: Date.now(),
  };
}

function formatFailure(failure: AssertionResult, stepIndex?: number, indent = 0): string {
  const pad = indent > 0 ? '  '.repeat(indent) : '';
  const prefix = stepIndex !== undefined && indent === 0 ? `[Step ${stepIndex}] ` : '';
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
