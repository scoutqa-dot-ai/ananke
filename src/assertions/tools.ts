import type { ToolCall } from '../types/data.js';
import type { RequireTool, ForbidCall, CountConstraint } from '../types/test.js';
import type { AssertionResult } from './types.js';
import { matchesPattern, stringify } from './utils.js';

/**
 * Check if a tool is forbidden
 */
export function assertForbiddenTools(
  toolCalls: ToolCall[],
  forbidden: string[]
): AssertionResult[] {
  const results: AssertionResult[] = [];

  for (const forbiddenName of forbidden) {
    const found = toolCalls.find((tc) => tc.name === forbiddenName);
    if (found) {
      results.push({
        passed: false,
        assertion: `Tool "${forbiddenName}" must not be called`,
        expected: 'not called',
        actual: `called with args: ${JSON.stringify(found.args)}`,
      });
    }
  }

  return results;
}

/**
 * Check required tool assertions
 */
export function assertRequiredTools(
  toolCalls: ToolCall[],
  required: RequireTool[]
): AssertionResult[] {
  const results: AssertionResult[] = [];

  for (const req of required) {
    // Start with calls matching the tool name
    let matchingCalls = toolCalls.filter((tc) => tc.name === req.name);

    // Check if tool was called at all
    if (matchingCalls.length === 0) {
      results.push({
        passed: false,
        assertion: `Tool "${req.name}" must be called`,
        expected: 'at least 1 call',
        actual: '0 calls',
      });
      continue;
    }

    // Filter by args_match if specified
    if (req.args_match) {
      matchingCalls = matchingCalls.filter((call) =>
        checkArgsMatch(call, req.args_match!)
      );
    }

    // Filter by result_match if specified
    if (req.result_match) {
      matchingCalls = matchingCalls.filter((call) =>
        matchesPattern(call.result, req.result_match!)
      );
    }

    // Filter out by result_not_match if specified
    if (req.result_not_match) {
      matchingCalls = matchingCalls.filter(
        (call) => !matchesPattern(call.result, req.result_not_match!)
      );
    }

    // Check count constraints (default: at least 1)
    const count = req.count ?? { min: 1 };
    const countResult = assertCount(req.name, matchingCalls.length, count, req.args_match);
    if (countResult) {
      results.push(countResult);
    }

    // Check ordering (after)
    if (req.after) {
      const afterResult = assertOrdering(toolCalls, req.name, req.after);
      if (afterResult) {
        results.push(afterResult);
      }
    }
  }

  return results;
}

/**
 * Check forbidden calls (conditional forbid based on args/result)
 */
export function assertForbiddenCalls(
  toolCalls: ToolCall[],
  forbidCalls: ForbidCall[]
): AssertionResult[] {
  const results: AssertionResult[] = [];

  for (const forbid of forbidCalls) {
    const matchingCalls = toolCalls.filter((tc) => tc.name === forbid.name);

    for (const call of matchingCalls) {
      let shouldForbid = true;

      // Check args_match condition
      if (forbid.args_match) {
        shouldForbid = checkArgsMatch(call, forbid.args_match);
      }

      // Check result_match condition
      if (shouldForbid && forbid.result_match) {
        shouldForbid = matchesPattern(call.result, forbid.result_match);
      }

      if (shouldForbid) {
        results.push({
          passed: false,
          assertion: `Tool "${forbid.name}" call forbidden`,
          details: forbid.args_match
            ? `args matched: ${JSON.stringify(forbid.args_match)}`
            : forbid.result_match
              ? `result matched: /${forbid.result_match}/`
              : undefined,
          actual: `called with result: ${stringify(call.result)}`,
        });
      }
    }
  }

  return results;
}

function assertCount(
  toolName: string,
  count: number,
  constraint: CountConstraint,
  argsMatch?: Record<string, string>
): AssertionResult | null {
  const suffix = argsMatch ? ' matching args' : '';

  if ('exact' in constraint) {
    if (count !== constraint.exact) {
      return {
        passed: false,
        assertion: `Tool "${toolName}" count${suffix}`,
        expected: `exactly ${constraint.exact}`,
        actual: `${count}`,
      };
    }
  } else {
    if (constraint.min !== undefined && count < constraint.min) {
      return {
        passed: false,
        assertion: `Tool "${toolName}" count${suffix}`,
        expected: `at least ${constraint.min}`,
        actual: `${count}`,
      };
    }
    if (constraint.max !== undefined && count > constraint.max) {
      return {
        passed: false,
        assertion: `Tool "${toolName}" count${suffix}`,
        expected: `at most ${constraint.max}`,
        actual: `${count}`,
      };
    }
  }
  return null;
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function checkArgsMatch(
  call: ToolCall,
  argsMatch: Record<string, string>
): boolean {
  for (const [key, pattern] of Object.entries(argsMatch)) {
    const value = getNestedValue(call.args, key);
    if (value === undefined) return false;
    if (!matchesPattern(value, pattern)) return false;
  }
  return true;
}

function assertOrdering(
  toolCalls: ToolCall[],
  toolName: string,
  afterTool: string
): AssertionResult | null {
  const afterIndex = toolCalls.findIndex((tc) => tc.name === afterTool);
  const toolIndex = toolCalls.findIndex((tc) => tc.name === toolName);

  if (afterIndex === -1) {
    return {
      passed: false,
      assertion: `Tool "${toolName}" must be called after "${afterTool}"`,
      expected: `"${afterTool}" called first`,
      actual: `"${afterTool}" not called`,
    };
  }

  if (toolIndex < afterIndex) {
    return {
      passed: false,
      assertion: `Tool "${toolName}" must be called after "${afterTool}"`,
      expected: `"${toolName}" after "${afterTool}"`,
      actual: `"${toolName}" called before "${afterTool}"`,
    };
  }

  return null;
}
