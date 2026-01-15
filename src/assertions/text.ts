import type { AssertionResult } from './types.js';
import { matchesPattern } from './utils.js';

export interface TextConstraints {
  must_match?: string;
  must_not_match?: string;
}

/**
 * Check text assertions
 */
export function assertText(
  text: string,
  constraints: TextConstraints
): AssertionResult[] {
  const results: AssertionResult[] = [];

  if (constraints.must_match) {
    if (!matchesPattern(text, constraints.must_match)) {
      results.push({
        passed: false,
        assertion: 'Text must match',
        expected: `match /${constraints.must_match}/`,
        actual: text.length > 100 ? `${text.slice(0, 100)}...` : text,
      });
    }
  }

  if (constraints.must_not_match) {
    if (matchesPattern(text, constraints.must_not_match)) {
      results.push({
        passed: false,
        assertion: 'Text must not match',
        expected: `not match /${constraints.must_not_match}/`,
        actual: text.length > 100 ? `${text.slice(0, 100)}...` : text,
      });
    }
  }

  return results;
}
