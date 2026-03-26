import type { ProtocolClient } from "../client/types.js";
import type { TimestampedEvent } from "../client/events.js";
import type { TurnData, TurnTimings, ToolCall } from "../types/index.js";
import type { Logger } from "../logger.js";
import { truncateLine, formatDuration } from "./format.js";
import { SLOW_TTF_TEXT_THRESHOLD_MS } from "../constants.js";

interface PendingToolCall {
  name: string;
  argsBuffer: string;
  startTs: number;
}

/**
 * Execute a user message turn and collect data
 */
export async function executeTurn(
  client: ProtocolClient,
  userMessage: string,
  turnIndex: number,
  options?: { logger?: Logger },
): Promise<TurnData> {
  const sendTs = Date.now();
  const events = client.sendMessage({ message: userMessage });
  return collectTurnData(events, turnIndex, { ...options, sendTs });
}

/**
 * Execute a connect turn (no message, just observe) and collect data
 */
export async function executeConnectTurn(
  client: ProtocolClient,
  turnIndex: number,
  options?: { logger?: Logger },
): Promise<TurnData> {
  if (!client.connect) {
    throw new Error("Client does not support connect operation");
  }
  const sendTs = Date.now();
  const events = client.connect();
  return collectTurnData(events, turnIndex, { ...options, sendTs });
}

export interface CollectOptions {
  logger?: Logger;
  /** Timestamp when the request was sent (for accurate idle tracking) */
  sendTs?: number;
}

/**
 * Collect turn data from an event stream
 * Uses timestamps from events (arrival time) for accurate timing
 */
export async function collectTurnData(
  events: AsyncGenerator<TimestampedEvent>,
  turnIndex: number,
  options?: CollectOptions,
): Promise<TurnData> {
  const toolCalls: ToolCall[] = [];
  const pendingToolCalls = new Map<string, PendingToolCall>();
  let assistantText = "";
  let startTs: number | null = null;
  let endTs: number | null = null;
  let lastEventTs = options?.sendTs ?? Date.now();
  const logger = options?.logger;
  const sendTs = options?.sendTs ?? Date.now();
  const timings: TurnTimings = {
    ttfEventMs: null,
    ttfToolMs: null,
    ttfTextMs: null,
  };

  for await (const event of events) {
    const eventTs = event._ts;
    if (startTs === null) {
      startTs = eventTs;
      timings.ttfEventMs = eventTs - sendTs;
    }
    endTs = eventTs;

    // Track TTF for tool and text
    if (timings.ttfToolMs === null && event.type === "TOOL_CALL_START") {
      timings.ttfToolMs = eventTs - sendTs;
    }
    if (timings.ttfTextMs === null && event.type === "TEXT_MESSAGE_CONTENT") {
      timings.ttfTextMs = eventTs - sendTs;
      if (timings.ttfTextMs >= SLOW_TTF_TEXT_THRESHOLD_MS) {
        logger?.warn(
          `[turn] Slow time-to-first-text: ${formatDuration(timings.ttfTextMs)}`,
        );
      }
    }

    // Trace logging with idle gap (only track idle between meaningful events)
    if (logger) {
      const isActivityEvent =
        event.type.startsWith("TOOL_CALL_") ||
        event.type === "TEXT_MESSAGE_CONTENT";
      const gap = eventTs - lastEventTs;
      const idleSuffix =
        isActivityEvent && gap >= 1000
          ? ` (idle ${(gap / 1000).toFixed(1)}s)`
          : "";
      if (isActivityEvent) {
        lastEventTs = eventTs;
      }
      logger.trace(
        `[event] ${event.type}${formatEventDetail(event)}${idleSuffix}`,
      );
    }

    handleEvent(event, toolCalls, pendingToolCalls, (text) => {
      assistantText += text;
    });
  }

  const fmt = (ms: number | null) => (ms === null ? "-" : formatDuration(ms));
  logger?.trace(
    `[turn] Timings: event=${fmt(timings.ttfEventMs)} tool=${fmt(timings.ttfToolMs)} text=${fmt(timings.ttfTextMs)}`,
  );

  // Fallback to current time if no events received
  const now = Date.now();

  return {
    turnIndex,
    toolCalls,
    assistantText,
    startTs: startTs ?? now,
    endTs: endTs ?? now,
    timings,
  };
}

function formatEventDetail(event: TimestampedEvent): string {
  switch (event.type) {
    case "TOOL_CALL_START":
      return `: ${event.toolCallName}`;
    case "TEXT_MESSAGE_CONTENT":
      return `: "${truncateLine(event.delta)}" (${event.delta.length} chars)`;
    case "RUN_ERROR":
      return `: ${event.message}`;
    default:
      return "";
  }
}

function handleEvent(
  event: TimestampedEvent,
  toolCalls: ToolCall[],
  pendingToolCalls: Map<string, PendingToolCall>,
  onText: (text: string) => void,
): void {
  switch (event.type) {
    case "TEXT_MESSAGE_CONTENT":
      onText(event.delta);
      break;

    case "TOOL_CALL_START":
      pendingToolCalls.set(event.toolCallId, {
        name: event.toolCallName,
        argsBuffer: "",
        startTs: event._ts, // Use event timestamp
      });
      break;

    case "TOOL_CALL_ARGS": {
      const pending = pendingToolCalls.get(event.toolCallId);
      if (pending) {
        pending.argsBuffer += event.delta;
      }
      break;
    }

    case "TOOL_CALL_RESULT": {
      const pending = pendingToolCalls.get(event.toolCallId);
      if (pending) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(pending.argsBuffer || "{}");
        } catch {
          // Keep empty args if parsing fails
        }

        let result: unknown = event.result;
        try {
          result = JSON.parse(event.result);
        } catch {
          // Keep as string if not valid JSON
        }

        toolCalls.push({
          name: pending.name,
          args,
          result,
          timestamp: event._ts, // Use event timestamp
        });

        pendingToolCalls.delete(event.toolCallId);
      }
      break;
    }

    case "RUN_ERROR":
      throw new Error(`AG-UI run error: ${event.message}`);
  }
}
