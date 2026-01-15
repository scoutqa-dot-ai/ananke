import { AGUIClient } from '../client/index.js';
import { executeHooks } from '../hooks/index.js';
import { interpolate, interpolateObject, type Variables } from '../config/interpolate.js';
import type { ProjectConfig, TestFile, TestData, TurnData } from '../types/index.js';
import { isUserTurn, isConnectTurn } from '../types/test.js';
import { executeTurn, executeConnectTurn } from './turn.js';
import {
  evaluateTurnAssertions,
  evaluateTestAssertions,
  type AssertionResult,
} from '../assertions/index.js';

export interface TestRunnerOptions {
  config: ProjectConfig;
  test: TestFile;
  verbose?: boolean;
  onLog?: (message: string) => void;
  onDebug?: (message: string) => void;
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
  const { config, test, verbose, onLog, onDebug } = options;
  const log = onLog ?? (() => {});
  const debug = onDebug ?? (() => {});

  const startTs = Date.now();
  const turns: TurnData[] = [];
  const failures: string[] = [];

  // Execute hooks and collect variables
  let variables: Variables = {};
  if (test.hooks && test.hooks.length > 0) {
    if (verbose) log('  Executing hooks...');
    try {
      variables = await executeHooks(test.hooks, { onDebug: debug });
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

  // Interpolate config with variables
  const endpoint = interpolate(config.target.endpoint, variables);
  const headers = config.target.headers
    ? interpolateObject(config.target.headers, variables)
    : undefined;
  const agentId = config.target.agentId
    ? interpolate(config.target.agentId, variables)
    : undefined;

  // Interpolate forwardedProps
  const forwardedProps = config.target.forwardedProps
    ? interpolateObject(config.target.forwardedProps, variables)
    : undefined;

  // Create client
  const client = new AGUIClient({
    endpoint,
    headers,
    agentId,
    onDebug: debug,
    state: config.target.state,
    forwardedProps,
  });

  // Execute turns
  let threadId: string | undefined;

  for (let i = 0; i < test.turns.length; i++) {
    const turn = test.turns[i];

    try {
      let result: { turnData: TurnData; threadId?: string };

      if (isConnectTurn(turn)) {
        // Connect turn - no message, just observe
        if (verbose) log(`  Turn ${i + 1}: [connect]`);
        result = await executeConnectTurn(client, i, threadId);
      } else if (isUserTurn(turn)) {
        // User message turn
        const userMessage = interpolate(turn.user, variables);
        if (verbose) log(`  Turn ${i + 1}: "${userMessage.slice(0, 50)}${userMessage.length > 50 ? '...' : ''}"`);
        result = await executeTurn(client, userMessage, i, threadId);
      } else {
        // Should never happen due to Zod validation
        throw new Error(`Unknown turn type at index ${i}`);
      }

      turns.push(result.turnData);
      threadId = result.threadId;

      if (verbose) {
        log(`    Tools: ${result.turnData.toolCalls.map((t) => t.name).join(', ') || '(none)'}`);
        log(`    Duration: ${result.turnData.endTs - result.turnData.startTs}ms`);
      }

      // Evaluate turn-level assertions
      if (turn.assert) {
        const evalResult = evaluateTurnAssertions(result.turnData, turn.assert);
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

  // Evaluate test-level assertions
  const testData = buildTestData(turns, startTs);
  if (test.assert) {
    const evalResult = evaluateTestAssertions(testData, test.assert);
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
