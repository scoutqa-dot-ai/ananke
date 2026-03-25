import type { TurnData, TestData } from "../types/data.js";
import type { AssertBlock } from "../types/test.js";
import type { Variables } from "../config/interpolate.js";
import type { AssertionResult, EvalContext, ScriptRunnerFn } from "./types.js";
import type { Logger } from "../logger.js";
import { evaluate, type AssertionNode } from "./evaluator.js";
import { extractSelector, SELECTOR_KEYS, type SelectorData } from "./selectors.js";
import {
  resolveAssertBlock,
  type NamedAssertions,
} from "./resolver.js";
import {
  normalizeScriptConfig,
  buildAnankeInput,
  executeScript,
} from "../runner/script.js";

export interface EvaluationOptions {
  namedAssertions?: NamedAssertions;
  logger?: Logger;
  /** Current variables map — passed to scripts and updated with script output */
  variables?: Variables;
  /** Completed turns so far — passed to scripts via ANANKE */
  turns?: TurnData[];
  /** Current turn index — passed to scripts via ANANKE */
  turnIndex?: number | null;
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
      turns: options?.turns,
      variables: options?.variables,
      turnIndex: options?.turnIndex,
    });

    const result = await executeScript(config, ananke, "assertion", {
      logger: options?.logger,
    });

    if (result.exitCode !== 0) {
      ctx.logger?.debug(`[assert] ${ctx.path.join(" → ")}: FAILED — ${result.stderr}`);
      return {
        passed: false,
        assertion: "script",
        path: ctx.path,
        expected: "exit code 0",
        actual: result.stderr.slice(0, 200),
      };
    }

    const { output } = result;

    // Handle actions
    if (output.action === "skip_assertion") {
      ctx.logger?.debug(`[assert] ${ctx.path.join(" → ")}: SKIPPED (skip_assertion)`);
      return { passed: true, assertion: "script (skipped)", path: ctx.path, reason: output.reason };
    }

    if (output.action === "skip_test") {
      return { passed: true, assertion: "script (skip_test)", path: ctx.path, details: "skip_test", reason: output.reason };
    }

    // Merge variables
    if (Object.keys(output.variables).length > 0 && options?.variables) {
      for (const [key, val] of Object.entries(output.variables)) {
        const old = options.variables[key];
        if (old !== undefined && old !== val) {
          ctx.logger?.debug(`[Script] Variable "${key}" overridden by assertion (was: "${old}", now: "${val}")`);
        }
        options.variables[key] = val;
      }
    }

    ctx.logger?.debug(`[assert] ${ctx.path.join(" → ")}: PASSED`);
    return {
      passed: true,
      assertion: "script",
      path: ctx.path,
      reason: output.reason,
      variables: Object.keys(output.variables).length > 0 ? output.variables : undefined,
    };
  };
}

/**
 * Evaluate an assert block against selector data.
 * Handles selector keys and top-level meta (and/or/not).
 */
async function evaluateAssertBlock(
  selectorData: SelectorData,
  assertions: AssertBlock,
  ctx: EvalContext,
): Promise<AssertionResult[]> {
  const results: AssertionResult[] = [];

  // Handle selector keys
  for (const selectorName of SELECTOR_KEYS) {
    const node = assertions[selectorName as keyof AssertBlock];
    if (node !== undefined) {
      const value = extractSelector(selectorName, selectorData);
      results.push(
        ...await evaluate(value, node as AssertionNode, { ...ctx, path: [selectorName] })
      );
    }
  }

  // Handle top-level meta: or, and, not (these wrap full assert blocks)
  if (assertions.or) {
    const branches = assertions.or as AssertBlock[];
    const allBranchFailures: AssertionResult[][] = [];
    let anyPassed = false;

    for (const branch of branches) {
      const branchResults = await evaluateAssertBlock(selectorData, branch, ctx);
      const failures = branchResults.filter((r) => !r.passed);
      if (failures.length === 0) {
        anyPassed = true;
        break;
      }
      allBranchFailures.push(failures);
    }

    if (!anyPassed) {
      results.push({
        passed: false,
        assertion: "or",
        path: ["or"],
        expected: "at least one branch to pass",
        actual: `all ${branches.length} branches failed`,
        details: allBranchFailures
          .map(
            (failures, i) =>
              `branch ${i + 1}: ${failures.map((f) => f.assertion).join(", ")}`
          )
          .join("; "),
      });
      ctx.logger?.debug(`[assert] or: FAILED — all ${branches.length} branches failed`);
    }
  }

  if (assertions.and) {
    const branches = assertions.and as AssertBlock[];
    for (const branch of branches) {
      results.push(...await evaluateAssertBlock(selectorData, branch, ctx));
    }
  }

  if (assertions.not) {
    const branch = assertions.not as AssertBlock;
    const innerResults = await evaluateAssertBlock(selectorData, branch, ctx);
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
 * Evaluate turn-level assertions
 */
export async function evaluateTurnAssertions(
  turnData: TurnData,
  assertions: AssertBlock,
  options?: EvaluationOptions
): Promise<EvaluationResult> {
  const resolved = options?.namedAssertions
    ? resolveAssertBlock(assertions, options.namedAssertions)
    : assertions;

  const selectorData: SelectorData = {
    assistantText: turnData.assistantText,
    toolCalls: turnData.toolCalls,
    startTs: turnData.startTs,
    endTs: turnData.endTs,
  };

  const ctx = buildEvalContext(options);
  const results = await evaluateAssertBlock(selectorData, resolved, ctx);
  const failures = results.filter((r) => !r.passed);
  return {
    passed: failures.length === 0,
    results,
    failures,
  };
}

/**
 * Evaluate test-level assertions
 */
export async function evaluateTestAssertions(
  testData: TestData,
  assertions: AssertBlock,
  options?: EvaluationOptions
): Promise<EvaluationResult> {
  const resolved = options?.namedAssertions
    ? resolveAssertBlock(assertions, options.namedAssertions)
    : assertions;

  const selectorData: SelectorData = {
    assistantText: testData.allAssistantTexts.join("\n"),
    toolCalls: testData.allToolCalls,
    startTs: testData.startTs,
    endTs: testData.endTs,
  };

  const ctx = buildEvalContext(options);
  const results = await evaluateAssertBlock(selectorData, resolved, ctx);
  const failures = results.filter((r) => !r.passed);
  return {
    passed: failures.length === 0,
    results,
    failures,
  };
}
