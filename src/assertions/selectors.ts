import type { ToolCall } from "../types/data.js";

export interface SelectorData {
  assistantText: string;
  toolCalls: ToolCall[];
  startTs: number;
  endTs: number;
}

/**
 * Extract a value for a given selector name from response data.
 */
export function extractSelector(
  name: string,
  data: SelectorData
): unknown {
  switch (name) {
    case "text":
      return data.assistantText;
    case "tool_names":
      return data.toolCalls.map((c) => c.name);
    case "tools":
      return data.toolCalls;
    case "response":
      return buildResponseData(data);
    default:
      throw new Error(`Unknown selector: ${name}`);
  }
}

/**
 * Build the flat response data object exposed by the `response` selector.
 */
function buildResponseData(data: SelectorData) {
  return {
    ...data,
    durationMs: data.endTs - data.startTs,
    idleMs: computeMaxIdleGap(data),
  };
}

/**
 * Compute the maximum idle gap among:
 * - start to first tool call
 * - between consecutive tool calls
 * - last tool call to end
 *
 * If zero tool calls, idleMs = endTs - startTs.
 */
function computeMaxIdleGap(data: SelectorData): number {
  const { toolCalls, startTs, endTs } = data;

  if (toolCalls.length === 0) {
    return endTs - startTs;
  }

  const sorted = [...toolCalls].sort((a, b) => a.timestamp - b.timestamp);

  let maxGap = sorted[0].timestamp - startTs;

  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].timestamp - sorted[i - 1].timestamp;
    if (gap > maxGap) maxGap = gap;
  }

  const lastGap = endTs - sorted[sorted.length - 1].timestamp;
  if (lastGap > maxGap) maxGap = lastGap;

  return maxGap;
}

/** The list of selector keys recognized at the top level of an assert block */
export const SELECTOR_KEYS = [
  "text",
  "tool_names",
  "tools",
  "response",
] as const;
