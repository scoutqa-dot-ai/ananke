import type { AssertBlock } from '../types/test.js';
import type { TurnData, TestData, ToolCall } from '../types/data.js';
import type { AssertionResult } from './types.js';
import {
  assertForbiddenTools,
  assertRequiredTools,
  assertForbiddenCalls,
} from './tools.js';
import { assertTiming } from './timing.js';
import { assertText } from './text.js';

export interface EvaluationResult {
  passed: boolean;
  results: AssertionResult[];
}

/**
 * Evaluate turn-level assertions
 */
export function evaluateTurnAssertions(
  turnData: TurnData,
  assertions: AssertBlock
): EvaluationResult {
  const results: AssertionResult[] = [];

  // Tool assertions
  if (assertions.tools) {
    if (assertions.tools.forbid) {
      results.push(
        ...assertForbiddenTools(turnData.toolCalls, assertions.tools.forbid)
      );
    }
    if (assertions.tools.require) {
      results.push(
        ...assertRequiredTools(turnData.toolCalls, assertions.tools.require)
      );
    }
    if (assertions.tools.forbid_calls) {
      results.push(
        ...assertForbiddenCalls(turnData.toolCalls, assertions.tools.forbid_calls)
      );
    }
  }

  // Timing assertions
  if (assertions.timing) {
    results.push(
      ...assertTiming(
        {
          startTs: turnData.startTs,
          endTs: turnData.endTs,
          toolCalls: turnData.toolCalls,
        },
        assertions.timing
      )
    );
  }

  // Text assertions
  if (assertions.text) {
    results.push(...assertText(turnData.assistantText, assertions.text));
  }

  const failures = results.filter((r) => !r.passed);
  return {
    passed: failures.length === 0,
    results: failures,
  };
}

/**
 * Evaluate test-level assertions
 */
export function evaluateTestAssertions(
  testData: TestData,
  assertions: AssertBlock
): EvaluationResult {
  const results: AssertionResult[] = [];

  // Tool assertions (across all turns)
  if (assertions.tools) {
    if (assertions.tools.forbid) {
      results.push(
        ...assertForbiddenTools(testData.allToolCalls, assertions.tools.forbid)
      );
    }
    if (assertions.tools.require) {
      results.push(
        ...assertRequiredTools(testData.allToolCalls, assertions.tools.require)
      );
    }
    if (assertions.tools.forbid_calls) {
      results.push(
        ...assertForbiddenCalls(
          testData.allToolCalls,
          assertions.tools.forbid_calls
        )
      );
    }
  }

  // Timing assertions
  if (assertions.timing) {
    results.push(
      ...assertTiming(
        {
          startTs: testData.startTs,
          endTs: testData.endTs,
          toolCalls: testData.allToolCalls,
        },
        assertions.timing
      )
    );
  }

  // Text assertions (combined text from all turns)
  if (assertions.text) {
    const combinedText = testData.allAssistantTexts.join('\n');
    results.push(...assertText(combinedText, assertions.text));
  }

  const failures = results.filter((r) => !r.passed);
  return {
    passed: failures.length === 0,
    results: failures,
  };
}
