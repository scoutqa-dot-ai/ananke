import type { AssertionResult } from "./types.js";
import { matchesPattern } from "./utils.js";

export interface TextConstraints {
  must_match?: string | string[];
  must_not_match?: string | string[];
}

/**
 * Normalize a value to an array
 */
function normalizeToArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Check text assertions
 */
export function assertText(
  text: string,
  constraints: TextConstraints
): AssertionResult[] {
  const results: AssertionResult[] = [];
  const truncatedText =
    text.length > 100 ? `${text.slice(0, 100)}...` : text;

  for (const pattern of normalizeToArray(constraints.must_match)) {
    if (!matchesPattern(text, pattern)) {
      results.push({
        passed: false,
        assertion: "Text must match",
        expected: `match /${pattern}/`,
        actual: truncatedText,
      });
    }
  }

  for (const pattern of normalizeToArray(constraints.must_not_match)) {
    if (matchesPattern(text, pattern)) {
      results.push({
        passed: false,
        assertion: "Text must not match",
        expected: `not match /${pattern}/`,
        actual: truncatedText,
      });
    }
  }

  return results;
}
