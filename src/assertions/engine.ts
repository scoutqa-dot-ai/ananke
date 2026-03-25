import type { TurnData, TestData } from "../types/data.js";
import type { AssertBlock } from "../types/test.js";
import type { AssertionResult, EvalContext } from "./types.js";
import type { Logger } from "../logger.js";
import { evaluate, type AssertionNode } from "./evaluator.js";
import { extractSelector, SELECTOR_KEYS, type SelectorData } from "./selectors.js";
import {
  resolveAssertBlock,
  type NamedAssertions,
} from "./resolver.js";

export interface EvaluationOptions {
  namedAssertions?: NamedAssertions;
  logger?: Logger;
}

export interface EvaluationResult {
  passed: boolean;
  /** All assertion results (both passed and failed) */
  results: AssertionResult[];
  /** Only the failures */
  failures: AssertionResult[];
}

/**
 * Evaluate an assert block against selector data.
 * Handles selector keys and top-level meta (and/or/not).
 */
function evaluateAssertBlock(
  selectorData: SelectorData,
  assertions: AssertBlock,
  logger?: Logger
): AssertionResult[] {
  const results: AssertionResult[] = [];

  // Handle selector keys
  for (const selectorName of SELECTOR_KEYS) {
    const node = assertions[selectorName as keyof AssertBlock];
    if (node !== undefined) {
      const value = extractSelector(selectorName, selectorData);
      results.push(
        ...evaluate(value, node as AssertionNode, { path: [selectorName], logger })
      );
    }
  }

  // Handle top-level meta: or, and, not (these wrap full assert blocks)
  if (assertions.or) {
    const branches = assertions.or as AssertBlock[];
    const allBranchFailures: AssertionResult[][] = [];
    let anyPassed = false;

    for (const branch of branches) {
      const branchResults = evaluateAssertBlock(selectorData, branch, logger);
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
      logger?.debug(`[assert] or: FAILED — all ${branches.length} branches failed`);
    }
  }

  if (assertions.and) {
    const branches = assertions.and as AssertBlock[];
    for (const branch of branches) {
      results.push(...evaluateAssertBlock(selectorData, branch, logger));
    }
  }

  if (assertions.not) {
    const branch = assertions.not as AssertBlock;
    const innerResults = evaluateAssertBlock(selectorData, branch, logger);
    const failures = innerResults.filter((r) => !r.passed);
    if (failures.length === 0) {
      results.push({
        passed: false,
        assertion: "not",
        path: ["not"],
        expected: "assertion to fail",
        actual: "assertion passed",
      });
      logger?.debug(`[assert] not: FAILED — inner assertion passed`);
    }
  }

  // Handle top-level script (passes raw selector data — scripts compute what they need)
  if (assertions.script !== undefined) {
    results.push(
      ...evaluate(
        JSON.stringify(selectorData),
        { script: assertions.script } as AssertionNode,
        { path: ["script"], logger }
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
      logger?.debug(`[assert] ${key}: FAILED — unknown assertion`);
    }
  }

  return results;
}

/**
 * Evaluate turn-level assertions
 */
export function evaluateTurnAssertions(
  turnData: TurnData,
  assertions: AssertBlock,
  options?: EvaluationOptions
): EvaluationResult {
  const resolved = options?.namedAssertions
    ? resolveAssertBlock(assertions, options.namedAssertions)
    : assertions;

  const selectorData: SelectorData = {
    assistantText: turnData.assistantText,
    toolCalls: turnData.toolCalls,
    startTs: turnData.startTs,
    endTs: turnData.endTs,
  };

  const results = evaluateAssertBlock(selectorData, resolved, options?.logger);
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
export function evaluateTestAssertions(
  testData: TestData,
  assertions: AssertBlock,
  options?: EvaluationOptions
): EvaluationResult {
  const resolved = options?.namedAssertions
    ? resolveAssertBlock(assertions, options.namedAssertions)
    : assertions;

  const selectorData: SelectorData = {
    assistantText: testData.allAssistantTexts.join("\n"),
    toolCalls: testData.allToolCalls,
    startTs: testData.startTs,
    endTs: testData.endTs,
  };

  const results = evaluateAssertBlock(selectorData, resolved, options?.logger);
  const failures = results.filter((r) => !r.passed);
  return {
    passed: failures.length === 0,
    results,
    failures,
  };
}
