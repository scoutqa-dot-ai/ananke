export interface AssertionResult {
  passed: boolean;
  assertion: string;
  expected?: string;
  actual?: string;
  details?: string;
}

export interface AssertionContext {
  scope: 'turn' | 'test';
  turnIndex?: number;
}
