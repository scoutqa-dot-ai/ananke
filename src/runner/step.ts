import type { ProtocolClient } from "../client/types.js";
import type { TimestampedProtocolEvent, TimestampedEvent } from "../client/events.js";
import type { StepData, StepTimings, ToolCall } from "../types/index.js";
import type { Logger } from "../logger.js";
import { truncateLine, formatDuration } from "./format.js";
import { SLOW_TTF_TEXT_THRESHOLD_MS } from "../constants.js";

interface PendingToolCall {
  name: string;
  argsBuffer: string;
  startTs: number;
}

/**
 * Prepend a synthetic ananke:prompt_sent event to an event stream.
 * This records the send timestamp so TTF calculations work in both live and replay.
 */
export async function* withPromptSent(
  events: AsyncGenerator<TimestampedEvent>,
): AsyncGenerator<TimestampedEvent> {
  yield { type: "ananke:prompt_sent", "ananke:ts": Date.now() };
  yield* events;
}

/**
 * Execute a message step and collect data
 */
export async function executeMessageStep(
  client: ProtocolClient,
  userMessage: string,
  stepIndex: number,
  options?: { logger?: Logger },
): Promise<StepData> {
  const events = withPromptSent(client.message(userMessage));
  return collectStepData(events, stepIndex, options);
}

/**
 * Execute a resume step (no message, just observe) and collect data
 */
export async function executeResumeStep(
  client: ProtocolClient,
  stepIndex: number,
  options?: { logger?: Logger },
): Promise<StepData> {
  if (!client.resume) {
    throw new Error("Client does not support resume operation");
  }
  const events = withPromptSent(client.resume());
  return collectStepData(events, stepIndex, options);
}

export interface CollectOptions {
  logger?: Logger;
}

/**
 * Collect step data from an event stream
 * Uses timestamps from events (arrival time) for accurate timing
 */
export async function collectStepData(
  events: AsyncGenerator<TimestampedEvent>,
  stepIndex: number,
  options?: CollectOptions,
): Promise<StepData> {
  const toolCalls: ToolCall[] = [];
  const pendingToolCalls = new Map<string, PendingToolCall>();
  let assistantText = "";
  let startTs: number | null = null;
  let endTs: number | null = null;
  let lastEventTs: number | null = null;
  const logger = options?.logger;
  const timings: StepTimings = {
    ttfEventMs: null,
    ttfToolMs: null,
    ttfTextMs: null,
  };

  let promptSentTs: number | null = null;

  for await (const event of events) {
    const eventTs = event["ananke:ts"];

    // Use ananke:prompt_sent as the TTF baseline
    if (event.type === "ananke:prompt_sent") {
      promptSentTs = eventTs;
      continue;
    }

    if (startTs === null) {
      startTs = eventTs;
    }
    endTs = eventTs;

    // Track TTF relative to prompt_sent timestamp
    const baseline = promptSentTs ?? startTs;
    const elapsed = eventTs - baseline;
    if (timings.ttfEventMs === null) {
      timings.ttfEventMs = elapsed;
    }
    if (timings.ttfToolMs === null && event.type === "TOOL_CALL_START") {
      timings.ttfToolMs = elapsed;
    }
    if (timings.ttfTextMs === null && event.type === "TEXT_MESSAGE_CONTENT") {
      timings.ttfTextMs = elapsed;
      if (timings.ttfTextMs >= SLOW_TTF_TEXT_THRESHOLD_MS) {
        logger?.warn(
          `[step] Slow time-to-first-text: ${formatDuration(timings.ttfTextMs)}`,
        );
      }
    }

    // Trace logging with idle gap (only track idle between meaningful events)
    if (logger) {
      const isActivityEvent =
        event.type.startsWith("TOOL_CALL_") ||
        event.type === "TEXT_MESSAGE_CONTENT";
      const gap = lastEventTs !== null ? eventTs - lastEventTs : 0;
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
    `[step] Timings: event=${fmt(timings.ttfEventMs)} tool=${fmt(timings.ttfToolMs)} text=${fmt(timings.ttfTextMs)}`,
  );

  // Fallback to current time if no events received
  const now = Date.now();

  return {
    stepIndex,
    toolCalls,
    assistantText,
    startTs: startTs ?? now,
    endTs: endTs ?? now,
    timings,
  };
}

function formatEventDetail(event: TimestampedProtocolEvent): string {
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
  event: TimestampedProtocolEvent,
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
        startTs: event["ananke:ts"], // Use event timestamp
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
          timestamp: event["ananke:ts"], // Use event timestamp
        });

        pendingToolCalls.delete(event.toolCallId);
      }
      break;
    }

    case "RUN_ERROR":
      throw new Error(`Protocol run error: ${event.message}`);
  }
}
