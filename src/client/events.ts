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
