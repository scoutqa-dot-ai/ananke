import type { Logger } from "../logger.js";
import type { Variables } from "../config/interpolate.js";

export interface AssertionResult {
  passed: boolean;
  assertion: string;
  expected?: string;
  actual?: string;
  details?: string;
  path?: string[];
  /** Variables set by script assertions (merged into variable map) */
  variables?: Variables;
  /** Debug reason from script assertion */
  reason?: string;
}

/**
 * Synchronous script runner callback for the evaluator.
 * Provided by the engine to bridge async script execution.
 */
export type ScriptRunnerFn = (
  value: unknown,
  operand: unknown,
  ctx: EvalContext
) => AssertionResult;

export interface EvalContext {
  path: string[];
  logger?: Logger;
  /** Script runner injected by the engine for script assertions */
  scriptRunner?: ScriptRunnerFn;
}
