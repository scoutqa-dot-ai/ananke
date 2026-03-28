export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  timestamp: number;
}

/** Time-to-first metrics (ms from send to first event of each kind) */
export interface StepTimings {
  /** Time to first protocol event of any type */
  ttfEventMs: number | null;
  /** Time to first TOOL_CALL_START event */
  ttfToolMs: number | null;
  /** Time to first TEXT_MESSAGE_CONTENT event */
  ttfTextMs: number | null;
}

/** Step type tag — matches the test file step types */
export type StepType = "message" | "resume" | "script";

/** Per-step assertion evaluation result (stored for reporting) */
export interface StepAssertionResult {
  passed: boolean;
  results: unknown[];
  failures: unknown[];
}

export interface StepData {
  stepIndex: number;
  type: StepType;
  toolCalls: ToolCall[];
  assistantText: string;
  startTs: number;
  endTs: number;
  timings: StepTimings;
  /** Per-step assertion results (present when step has assertions) */
  assertions?: StepAssertionResult;
  /** Script exit code (present only for script steps; non-zero means test was skipped) */
  exitCode?: number;
}

export interface TestData {
  steps: StepData[];
  allToolCalls: ToolCall[];
  allAssistantTexts: string[];
  startTs: number;
  endTs: number;
}
