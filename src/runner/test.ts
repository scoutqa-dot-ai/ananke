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
import { isUserTurn, isConnectTurn } from "../types/test.js";
import { executeTurn, executeConnectTurn, collectTurnData } from "./turn.js";
import { mergeAssertBlocks } from "./merge.js";
import {
  evaluateTurnAssertions,
  evaluateTestAssertions,
  type AssertionResult,
} from "../assertions/index.js";
import {
  getTestRecordingDir,
  createRecordingGenerator,
  recordHookOutput,
  replayEvents,
  loadHookOutput,
} from "../recording/index.js";

export interface TestRunnerOptions {
  config: ProjectConfig;
  test: TestFile;
  testFilePath: string;
  verbose?: boolean;
  onLog?: (message: string) => void;
  onDebug?: (message: string) => void;
  recordDir?: string;
  replayDir?: string;
}

export interface TestResult {
  testName: string;
  passed: boolean;
  testData: TestData;
  error?: string;
  failures: string[];
}

/**
 * Run a single test file
 */
export async function runTest(options: TestRunnerOptions): Promise<TestResult> {
  const { config, test, testFilePath, verbose, onLog, onDebug, recordDir, replayDir } = options;
  const log = onLog ?? (() => {});
  const debug = onDebug ?? (() => {});

  const startTs = Date.now();
  const turns: TurnData[] = [];
  const failures: string[] = [];

  // Get recording directory for this test (use relative path)
  const relativeTestPath = relative(process.cwd(), testFilePath);
  const testRecordingDir = recordDir ? getTestRecordingDir(recordDir, relativeTestPath) : undefined;
  const testReplayDir = replayDir ? getTestRecordingDir(replayDir, relativeTestPath) : undefined;

  if (testReplayDir) {
    debug(`[Replay] Loading from: ${testReplayDir}`);
  } else if (testRecordingDir) {
    debug(`[Record] Saving to: ${testRecordingDir}`);
  }

  // Execute hooks and collect variables
  let variables: Variables = {};
  if (test.hooks && test.hooks.length > 0) {
    if (replayDir) {
      // Replay mode: load hook outputs from files
      if (verbose) log('  Loading hooks from recording...');
      for (let i = 0; i < test.hooks.length; i++) {
        const hookVars = await loadHookOutput(replayDir, relativeTestPath, i);
        if (hookVars) {
          Object.assign(variables, hookVars);
        }
      }
      if (verbose) {
        const varKeys = Object.keys(variables);
        if (varKeys.length > 0) {
          log(`  Variables: ${varKeys.join(', ')}`);
        }
      }
    } else {
      // Normal/record mode: execute hooks
      if (verbose) log('  Executing hooks...');
      try {
        for (let i = 0; i < test.hooks.length; i++) {
          const result = await executeHook(test.hooks[i], { currentVars: variables, onDebug: debug });
          Object.assign(variables, result.variables);

          // Record hook output if recording
          if (testRecordingDir) {
            await recordHookOutput(testRecordingDir, i, result.variables);
          }
        }
        if (verbose) {
          const varKeys = Object.keys(variables);
          if (varKeys.length > 0) {
            log(`  Variables: ${varKeys.join(', ')}`);
          }
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

  // Interpolate config with variables
  const interpolatedConfig = interpolateObject(config, variables) as ProjectConfig;

  // Create client (only needed for non-replay mode)
  const client: ProtocolClient | undefined = testReplayDir
    ? undefined
    : createClient(interpolatedConfig, { onDebug: debug });

  // Execute turns
  for (let i = 0; i < test.turns.length; i++) {
    const turn = test.turns[i];

    try {
      let turnData: TurnData;

      if (testReplayDir) {
        // Replay mode: load events from file
        if (isConnectTurn(turn)) {
          if (verbose) log(`  Turn ${i + 1}: [connect] (replay)`);
        } else if (isUserTurn(turn)) {
          const userMessage = interpolate(turn.user, variables);
          if (verbose) log(`  Turn ${i + 1}: "${userMessage.slice(0, 50)}${userMessage.length > 50 ? '...' : ''}" (replay)`);
        }
        const events = replayEvents(replayDir!, relativeTestPath, i);
        turnData = await collectTurnData(events, i);
      } else if (isConnectTurn(turn)) {
        // Connect turn - no message, just observe
        if (verbose) log(`  Turn ${i + 1}: [connect]`);
        if (!client!.connect) {
          throw new Error("Client does not support connect operation");
        }
        if (testRecordingDir) {
          const events = createRecordingGenerator(client!.connect(), testRecordingDir, i);
          turnData = await collectTurnData(events, i);
        } else {
          turnData = await executeConnectTurn(client!, i);
        }
      } else if (isUserTurn(turn)) {
        // User message turn
        const userMessage = interpolate(turn.user, variables);
        if (verbose) log(`  Turn ${i + 1}: "${userMessage.slice(0, 50)}${userMessage.length > 50 ? '...' : ''}"`);
        if (testRecordingDir) {
          const events = createRecordingGenerator(client!.sendMessage({ message: userMessage }), testRecordingDir, i);
          turnData = await collectTurnData(events, i);
        } else {
          turnData = await executeTurn(client!, userMessage, i);
        }
      } else {
        // Should never happen due to Zod validation
        throw new Error(`Unknown turn type at index ${i}`);
      }

      turns.push(turnData);

      if (verbose) {
        log(`    Tools: ${turnData.toolCalls.map((t) => t.name).join(', ') || '(none)'}`);
        log(`    Duration: ${turnData.endTs - turnData.startTs}ms`);
      }

      // Evaluate turn-level assertions (merged: target -> test -> turn)
      const turnAssertions = mergeAssertBlocks(
        interpolatedConfig.target.assert,
        test.assert,
        turn.assert
      );
      const hasAssertions =
        turnAssertions.tools?.forbid?.length ||
        turnAssertions.tools?.require?.length ||
        turnAssertions.tools?.forbid_calls?.length ||
        turnAssertions.timing?.max_duration_ms !== undefined ||
        turnAssertions.timing?.max_idle_ms !== undefined ||
        turnAssertions.text?.must_match?.length ||
        turnAssertions.text?.must_not_match?.length;

      if (hasAssertions) {
        const evalResult = evaluateTurnAssertions(turnData, turnAssertions);
        if (!evalResult.passed) {
          for (const failure of evalResult.results) {
            const msg = formatFailure(failure, i + 1);
            failures.push(msg);
            if (verbose) log(`    ${msg}`);
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
        failures: [`Turn ${i + 1} failed: ${(err as Error).message}`],
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
  const hasTestAssertions =
    testAssertions.tools?.forbid?.length ||
    testAssertions.tools?.require?.length ||
    testAssertions.tools?.forbid_calls?.length ||
    testAssertions.timing?.max_duration_ms !== undefined ||
    testAssertions.timing?.max_idle_ms !== undefined ||
    testAssertions.text?.must_match?.length ||
    testAssertions.text?.must_not_match?.length;

  if (hasTestAssertions) {
    const evalResult = evaluateTestAssertions(testData, testAssertions);
    if (!evalResult.passed) {
      for (const failure of evalResult.results) {
        const msg = formatFailure(failure);
        failures.push(msg);
        if (verbose) log(`  ${msg}`);
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
  let msg = `${prefix}${failure.assertion}`;
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
