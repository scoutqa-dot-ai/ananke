export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  timestamp: number;
}

export interface TurnData {
  turnIndex: number;
  toolCalls: ToolCall[];
  assistantText: string;
  startTs: number;
  endTs: number;
}

export interface TestData {
  turns: TurnData[];
  allToolCalls: ToolCall[];
  allAssistantTexts: string[];
  startTs: number;
  endTs: number;
}
