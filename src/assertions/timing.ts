import type { ToolCall } from "../types/data.js";
import type { AssertionResult } from "./types.js";

export interface TimingContext {
  startTs: number;
  endTs: number;
  toolCalls: ToolCall[];
}

export interface TimingConstraints {
  max_duration_ms?: number | false;
  max_idle_ms?: number | false;
}

interface IdleGap {
  from: string;
  to: string;
  duration: number;
}

/**
 * Compute all idle gaps in the timing context
 * Includes: start-to-first-tool, between-tools, last-tool-to-end
 */
function computeIdleGaps(context: TimingContext): IdleGap[] {
  const gaps: IdleGap[] = [];
  const sorted = [...context.toolCalls].sort(
    (a, b) => a.timestamp - b.timestamp
  );

  // If no tool calls, entire duration is idle
  if (sorted.length === 0) {
    gaps.push({
      from: "start",
      to: "end",
      duration: context.endTs - context.startTs,
    });
    return gaps;
  }

  // Gap from start to first tool call
  gaps.push({
    from: "start",
    to: sorted[0].name,
    duration: sorted[0].timestamp - context.startTs,
  });

  // Gaps between tool calls
  for (let i = 1; i < sorted.length; i++) {
    gaps.push({
      from: sorted[i - 1].name,
      to: sorted[i].name,
      duration: sorted[i].timestamp - sorted[i - 1].timestamp,
    });
  }

  // Gap from last tool call to end
  const last = sorted[sorted.length - 1];
  gaps.push({
    from: last.name,
    to: "end",
    duration: context.endTs - last.timestamp,
  });

  return gaps;
}

/**
 * Check timing assertions
 */
export function assertTiming(
  context: TimingContext,
  constraints: TimingConstraints
): AssertionResult[] {
  const results: AssertionResult[] = [];

  // Check max duration (skip if false)
  if (
    constraints.max_duration_ms !== undefined &&
    constraints.max_duration_ms !== false
  ) {
    const duration = context.endTs - context.startTs;
    if (duration > constraints.max_duration_ms) {
      results.push({
        passed: false,
        assertion: "Duration constraint",
        expected: `≤ ${constraints.max_duration_ms}ms`,
        actual: `${duration}ms`,
      });
    }
  }

  // Check max idle (skip if false)
  if (
    constraints.max_idle_ms !== undefined &&
    constraints.max_idle_ms !== false
  ) {
    const gaps = computeIdleGaps(context);
    for (const gap of gaps) {
      if (gap.duration > constraints.max_idle_ms) {
        results.push({
          passed: false,
          assertion: "Idle constraint",
          expected: `≤ ${constraints.max_idle_ms}ms`,
          actual: `${gap.duration}ms between "${gap.from}" and "${gap.to}"`,
        });
      }
    }
  }

  return results;
}
