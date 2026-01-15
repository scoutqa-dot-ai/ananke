import { AGUIClient } from '../client/index.js';
import { executeHooks } from '../hooks/index.js';
import { interpolate, interpolateObject, type Variables } from '../config/interpolate.js';
import type { ProjectConfig, TestFile, TestData, TurnData } from '../types/index.js';
import { executeTurn } from './turn.js';

export interface TestRunnerOptions {
  config: ProjectConfig;
  test: TestFile;
  verbose?: boolean;
  onLog?: (message: string) => void;
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
  const { config, test, verbose, onLog } = options;
  const log = onLog ?? (() => {});

  const startTs = Date.now();
  const turns: TurnData[] = [];
  const failures: string[] = [];

  // Execute hooks and collect variables
  let variables: Variables = {};
  if (test.hooks && test.hooks.length > 0) {
    if (verbose) log('  Executing hooks...');
    try {
      variables = await executeHooks(test.hooks);
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

  // Create client
  const client = new AGUIClient({ endpoint, headers });

  // Execute turns
  let threadId: string | undefined;

  for (let i = 0; i < test.turns.length; i++) {
    const turn = test.turns[i];
    const userMessage = interpolate(turn.user, variables);

    if (verbose) log(`  Turn ${i + 1}: "${userMessage.slice(0, 50)}${userMessage.length > 50 ? '...' : ''}"`);

    try {
      const result = await executeTurn(client, userMessage, i, threadId);
      turns.push(result.turnData);
      threadId = result.threadId;

      if (verbose) {
        log(`    Tools: ${result.turnData.toolCalls.map((t) => t.name).join(', ') || '(none)'}`);
        log(`    Duration: ${result.turnData.endTs - result.turnData.startTs}ms`);
      }

      // TODO: Phase 4 - Evaluate turn-level assertions
      // For now, just collect data
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

  // TODO: Phase 4 - Evaluate test-level assertions

  return {
    testName: test.name,
    passed: failures.length === 0,
    testData: buildTestData(turns, startTs),
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
