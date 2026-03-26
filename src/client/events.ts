/**
 * AG-UI event types based on the protocol specification
 */

export interface RunStartedEvent {
  type: 'RUN_STARTED';
  runId: string;
  threadId?: string;
}

export interface RunFinishedEvent {
  type: 'RUN_FINISHED';
  runId: string;
}

export interface RunErrorEvent {
  type: 'RUN_ERROR';
  runId: string;
  message: string;
  code?: string;
}

export interface TextMessageStartEvent {
  type: 'TEXT_MESSAGE_START';
  messageId: string;
  role: 'assistant';
}

export interface TextMessageContentEvent {
  type: 'TEXT_MESSAGE_CONTENT';
  messageId: string;
  delta: string;
}

export interface TextMessageEndEvent {
  type: 'TEXT_MESSAGE_END';
  messageId: string;
}

export interface ToolCallStartEvent {
  type: 'TOOL_CALL_START';
  toolCallId: string;
  toolCallName: string;
  parentMessageId?: string;
}

export interface ToolCallArgsEvent {
  type: 'TOOL_CALL_ARGS';
  toolCallId: string;
  delta: string;
}

export interface ToolCallEndEvent {
  type: 'TOOL_CALL_END';
  toolCallId: string;
}

export interface ToolCallResultEvent {
  type: 'TOOL_CALL_RESULT';
  toolCallId: string;
  result: string;
}

export type AGUIEvent =
  | RunStartedEvent
  | RunFinishedEvent
  | RunErrorEvent
  | TextMessageStartEvent
  | TextMessageContentEvent
  | TextMessageEndEvent
  | ToolCallStartEvent
  | ToolCallArgsEvent
  | ToolCallEndEvent
  | ToolCallResultEvent;

export type AGUIEventType = AGUIEvent["type"];

/**
 * Event with timestamp added at arrival time
 */
export type TimestampedEvent = AGUIEvent & { _ts: number };


/**
 * Convert a raw event object to a typed AGUIEvent.
 * Accepts both the @ag-ui/client BaseEvent shape and the Zod-parsed shape.
 */
export function convertToAGUIEvent(event: {
  type: string;
  [key: string]: unknown;
}): AGUIEvent | null {
  switch (event.type) {
    case "RUN_STARTED":
      return {
        type: "RUN_STARTED",
        runId: String(event.runId ?? ""),
        threadId: event.threadId as string | undefined,
      };

    case "TEXT_MESSAGE_START":
      return {
        type: "TEXT_MESSAGE_START",
        messageId: String(event.messageId ?? ""),
        role: "assistant",
      };

    case "TEXT_MESSAGE_CONTENT":
      return {
        type: "TEXT_MESSAGE_CONTENT",
        messageId: String(event.messageId ?? ""),
        delta: String(event.delta ?? ""),
      };

    case "TEXT_MESSAGE_END":
      return {
        type: "TEXT_MESSAGE_END",
        messageId: String(event.messageId ?? ""),
      };

    case "TOOL_CALL_START":
      return {
        type: "TOOL_CALL_START",
        toolCallId: String(event.toolCallId ?? ""),
        toolCallName: String(event.toolCallName ?? ""),
        parentMessageId: event.parentMessageId as string | undefined,
      };

    case "TOOL_CALL_ARGS":
      return {
        type: "TOOL_CALL_ARGS",
        toolCallId: String(event.toolCallId ?? ""),
        delta: String(event.delta ?? ""),
      };

    case "TOOL_CALL_END":
      return {
        type: "TOOL_CALL_END",
        toolCallId: String(event.toolCallId ?? ""),
      };

    case "TOOL_CALL_RESULT":
      return {
        type: "TOOL_CALL_RESULT",
        toolCallId: String(event.toolCallId ?? ""),
        result:
          typeof event.result === "string"
            ? event.result
            : JSON.stringify(event.result ?? ""),
      };

    case "RUN_ERROR":
      return {
        type: "RUN_ERROR",
        runId: String(event.runId ?? ""),
        message: String(event.message ?? event.error ?? "Unknown error"),
        code: event.code as string | undefined,
      };

    case "RUN_FINISHED":
      return {
        type: "RUN_FINISHED",
        runId: String(event.runId ?? ""),
      };

    default:
      return null;
  }
}
