import type { StepData } from "../types/data.js";
import type { ExpectBlock } from "../types/test.js";
import type { Variables } from "../config/interpolate.js";
import type { AssertionResult, EvalContext, ScriptRunnerFn } from "./types.js";
import type { Logger } from "../logger.js";
import { evaluate, type AssertionNode } from "./evaluator.js";
import { extractSelector, SELECTOR_KEYS, type SelectorData } from "./selectors.js";
import {
  resolveExpectBlock,
  type NamedAssertions,
} from "./resolver.js";
import {
  normalizeScriptConfig,
  buildAnankeInput,
  executeScript,
  mergeVariables,
} from "../runner/script.js";

export interface EvaluationOptions {
  namedAssertions?: NamedAssertions;
  logger?: Logger;
  /** Current variables map — passed to scripts and updated with script output */
  variables?: Variables;
  /** Completed steps so far — passed to scripts via ANANKE */
  steps?: StepData[];
  /** Current step index — passed to scripts via ANANKE */
  stepIndex?: number | null;
}

export interface EvaluationResult {
  passed: boolean;
  /** All assertion results (both passed and failed) */
  results: AssertionResult[];
  /** Only the failures */
  failures: AssertionResult[];
}

/**
 * Create an async script runner that uses the shared executeScript.
 */
function createScriptRunner(
  options: EvaluationOptions | undefined,
): ScriptRunnerFn {
  return async (value, operand, ctx) => {
    const config = normalizeScriptConfig(operand);
    const ananke = buildAnankeInput({
      value,
      steps: options?.steps,
      variables: options?.variables,
      stepIndex: options?.stepIndex,
    });

    const result = await executeScript(config, ananke, {
      logger: options?.logger,
    });

    if (result.exitCode !== 0) {
      const expected = `${config.run}: exit code 0`;
      const actual = `exit code ${result.exitCode}${result.stderr ? `: ${result.stderr.slice(0, 200)}` : ""}`;
      ctx.logger?.debug(`[assert] ${ctx.path.join(" → ")}: FAILED — script (expected: ${expected}, got: ${actual})`);
      return {
        passed: false,
        assertion: "script",
        path: ctx.path,
        expected,
        actual,
      };
    }

    const { output } = result;

    // Merge variables
    if (Object.keys(output.variables).length > 0 && options?.variables) {
      mergeVariables(options.variables, output.variables, "assertion", ctx.logger);
    }

    ctx.logger?.debug(`[assert] ${ctx.path.join(" → ")}: PASSED`);
    return {
      passed: true,
      assertion: "script",
      path: ctx.path,
      variables: Object.keys(output.variables).length > 0 ? output.variables : undefined,
    };
  };
}

/**
 * Evaluate an assert block against selector data.
 * Handles selector keys and top-level meta (and/or/not).
 */
async function evaluateExpectBlock(
  selectorData: SelectorData,
  assertions: ExpectBlock,
  ctx: EvalContext,
): Promise<AssertionResult[]> {
  const results: AssertionResult[] = [];

  // Handle selector keys
  for (const selectorName of SELECTOR_KEYS) {
    const node = assertions[selectorName as keyof ExpectBlock];
    if (node !== undefined) {
      const value = extractSelector(selectorName, selectorData);
      results.push(
        ...await evaluate(value, node as AssertionNode, { ...ctx, path: [selectorName] })
      );
    }
  }

  // Handle top-level meta: or, and, not (these wrap full assert blocks)
  if (assertions.or) {
    const branches = assertions.or as ExpectBlock[];
    const branchChildren: AssertionResult[] = [];
    let anyPassed = false;

    for (let i = 0; i < branches.length; i++) {
      const branchResults = await evaluateExpectBlock(selectorData, branches[i], ctx);
      const failures = branchResults.filter((r) => !r.passed);
      if (failures.length === 0) {
        anyPassed = true;
        break;
      }
      branchChildren.push(...failures);
    }

    if (!anyPassed) {
      results.push({
        passed: false,
        assertion: "or",
        path: ["or"],
        expected: "at least one branch to pass",
        actual: `all ${branches.length} branches failed`,
        children: branchChildren,
      });
      ctx.logger?.debug(`[assert] or: FAILED — all ${branches.length} branches failed`);
    }
  }

  if (assertions.and) {
    const branches = assertions.and as ExpectBlock[];
    for (const branch of branches) {
      results.push(...await evaluateExpectBlock(selectorData, branch, ctx));
    }
  }

  if (assertions.not) {
    const branch = assertions.not as ExpectBlock;
    const innerResults = await evaluateExpectBlock(selectorData, branch, ctx);
    const failures = innerResults.filter((r) => !r.passed);
    if (failures.length === 0) {
      results.push({
        passed: false,
        assertion: "not",
        path: ["not"],
        expected: "assertion to fail",
        actual: "assertion passed",
      });
      ctx.logger?.debug(`[assert] not: FAILED — inner assertion passed`);
    }
  }

  // Handle top-level script (passes raw selector data — scripts compute what they need)
  if (assertions.script !== undefined) {
    results.push(
      ...await evaluate(
        JSON.stringify(selectorData),
        { script: assertions.script } as AssertionNode,
        { ...ctx, path: ["script"] }
      )
    );
  }

  // Flag unknown keys (should not remain after resolution)
  const knownBlockKeys = new Set([...SELECTOR_KEYS, "or", "and", "not", "script"]);
  for (const key of Object.keys(assertions)) {
    if (!knownBlockKeys.has(key)) {
      results.push({
        passed: false,
        assertion: `Unknown assertion "${key}"`,
        path: [key],
        expected: "a valid selector, operator, or named assertion",
        actual: `unrecognized key "${key}"`,
      });
      ctx.logger?.debug(`[assert] ${key}: FAILED — unknown assertion`);
    }
  }

  return results;
}

/**
 * Build a root EvalContext from evaluation options.
 */
function buildEvalContext(options?: EvaluationOptions): EvalContext {
  return {
    path: [],
    logger: options?.logger,
    scriptRunner: createScriptRunner(options),
  };
}

/**
 * Evaluate step-level assertions
 */
export async function evaluateStepAssertions(
  stepData: StepData,
  assertions: ExpectBlock,
  options?: EvaluationOptions
): Promise<EvaluationResult> {
  const resolved = options?.namedAssertions
    ? resolveExpectBlock(assertions, options.namedAssertions)
    : assertions;

  const selectorData: SelectorData = {
    assistantText: stepData.assistantText,
    toolCalls: stepData.toolCalls,
    startTs: stepData.startTs,
    endTs: stepData.endTs,
  };

  const ctx = buildEvalContext(options);
  const results = await evaluateExpectBlock(selectorData, resolved, ctx);
  const failures = results.filter((r) => !r.passed);
  return {
    passed: failures.length === 0,
    results,
    failures,
  };
}

