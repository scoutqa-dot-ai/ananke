import type { TurnData, TestData } from "../types/data.js";
import type { AssertBlock } from "../types/test.js";
import type { AssertionResult } from "./types.js";
import { evaluate, type AssertionNode } from "./evaluator.js";
import { extractSelector, SELECTOR_KEYS, type SelectorData } from "./selectors.js";

export interface EvaluationResult {
  passed: boolean;
  results: AssertionResult[];
}

/**
 * Evaluate an assert block against selector data.
 * Handles selector keys and top-level meta (and/or/not).
 */
function evaluateAssertBlock(
  selectorData: SelectorData,
  assertions: AssertBlock
): AssertionResult[] {
  const results: AssertionResult[] = [];

  // Handle selector keys
  for (const selectorName of SELECTOR_KEYS) {
    const node = assertions[selectorName as keyof AssertBlock];
    if (node !== undefined) {
      const value = extractSelector(selectorName, selectorData);
      results.push(
        ...evaluate(value, node as AssertionNode, { path: [selectorName] })
      );
    }
  }

  // Handle top-level meta: or, and, not (these wrap full assert blocks)
  if (assertions.or) {
    const branches = assertions.or as AssertBlock[];
    const allBranchFailures: AssertionResult[][] = [];
    let anyPassed = false;

    for (const branch of branches) {
      const branchResults = evaluateAssertBlock(selectorData, branch);
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
    }
  }

  if (assertions.and) {
    const branches = assertions.and as AssertBlock[];
    for (const branch of branches) {
      results.push(...evaluateAssertBlock(selectorData, branch));
    }
  }

  if (assertions.not) {
    const branch = assertions.not as AssertBlock;
    const innerResults = evaluateAssertBlock(selectorData, branch);
    const failures = innerResults.filter((r) => !r.passed);
    if (failures.length === 0) {
      results.push({
        passed: false,
        assertion: "not",
        path: ["not"],
        expected: "assertion to fail",
        actual: "assertion passed",
      });
    }
  }

  return results;
}

/**
 * Evaluate turn-level assertions
 */
export function evaluateTurnAssertions(
  turnData: TurnData,
  assertions: AssertBlock
): EvaluationResult {
  const selectorData: SelectorData = {
    assistantText: turnData.assistantText,
    toolCalls: turnData.toolCalls,
    startTs: turnData.startTs,
    endTs: turnData.endTs,
  };

  const allResults = evaluateAssertBlock(selectorData, assertions);
  const failures = allResults.filter((r) => !r.passed);
  return {
    passed: failures.length === 0,
    results: failures,
  };
}

/**
 * Evaluate test-level assertions
 */
export function evaluateTestAssertions(
  testData: TestData,
  assertions: AssertBlock
): EvaluationResult {
  const selectorData: SelectorData = {
    assistantText: testData.allAssistantTexts.join("\n"),
    toolCalls: testData.allToolCalls,
    startTs: testData.startTs,
    endTs: testData.endTs,
  };

  const allResults = evaluateAssertBlock(selectorData, assertions);
  const failures = allResults.filter((r) => !r.passed);
  return {
    passed: failures.length === 0,
    results: failures,
  };
}
