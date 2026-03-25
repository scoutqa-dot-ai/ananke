import type { Logger } from "../logger.js";

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
  logger?: Logger;
}
