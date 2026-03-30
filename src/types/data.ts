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

/** Step input — the step definition from the test file, without expect (stored separately as assertions) */
export type StepInput = Record<string, unknown>;

/** Per-step assertion evaluation result (stored for reporting) */
export interface StepAssertionResult {
  passed: boolean;
  results: unknown[];
  failures: unknown[];
}

export interface StepData {
  stepIndex: number;
  /** The step definition from the test file (expect stripped; values interpolated) */
  input: StepInput;
  toolCalls: ToolCall[];
  assistantText: string;
  startTs: number;
  endTs: number;
  timings: StepTimings;
  /** Number of transport-level frames received (STOMP messages or SSE events) */
  transportFrameCount?: number;
  /** Total bytes received at the transport level */
  transportBytesReceived?: number;
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
