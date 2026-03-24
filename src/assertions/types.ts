export interface AssertionResult {
  passed: boolean;
  assertion: string;
  expected?: string;
  actual?: string;
  details?: string;
  path?: string[];
}

export interface EvalContext {
  path: string[];
}
