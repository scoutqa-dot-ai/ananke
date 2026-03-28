export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  timestamp: number;
}

/** Time-to-first metrics (ms from send to first event of each kind) */
export interface StepTimings {
  /** Time to first AG-UI event of any type */
  ttfEventMs: number | null;
  /** Time to first TOOL_CALL_START event */
  ttfToolMs: number | null;
  /** Time to first TEXT_MESSAGE_CONTENT event */
  ttfTextMs: number | null;
}

export interface StepData {
  stepIndex: number;
  toolCalls: ToolCall[];
  assistantText: string;
  startTs: number;
  endTs: number;
  timings: StepTimings;
}

export interface TestData {
  steps: StepData[];
  allToolCalls: ToolCall[];
  allAssistantTexts: string[];
  startTs: number;
  endTs: number;
}
