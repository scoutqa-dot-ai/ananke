import type { ToolCall } from '../types/data.js';
import type { AssertionResult } from './types.js';

export interface TimingContext {
  startTs: number;
  endTs: number;
  toolCalls: ToolCall[];
}

export interface TimingConstraints {
  max_duration_ms?: number;
  max_gap_ms?: number;
}

/**
 * Check timing assertions
 */
export function assertTiming(
  context: TimingContext,
  constraints: TimingConstraints
): AssertionResult[] {
  const results: AssertionResult[] = [];

  // Check max duration
  if (constraints.max_duration_ms !== undefined) {
    const duration = context.endTs - context.startTs;
    if (duration > constraints.max_duration_ms) {
      results.push({
        passed: false,
        assertion: 'Duration constraint',
        expected: `≤ ${constraints.max_duration_ms}ms`,
        actual: `${duration}ms`,
      });
    }
  }

  // Check max gap between tool calls
  if (constraints.max_gap_ms !== undefined && context.toolCalls.length > 1) {
    const sortedCalls = [...context.toolCalls].sort(
      (a, b) => a.timestamp - b.timestamp
    );

    for (let i = 1; i < sortedCalls.length; i++) {
      const gap = sortedCalls[i].timestamp - sortedCalls[i - 1].timestamp;
      if (gap > constraints.max_gap_ms) {
        results.push({
          passed: false,
          assertion: 'Gap between tool calls',
          expected: `≤ ${constraints.max_gap_ms}ms`,
          actual: `${gap}ms between "${sortedCalls[i - 1].name}" and "${sortedCalls[i].name}"`,
        });
      }
    }
  }

  return results;
}
