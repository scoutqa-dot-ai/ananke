import type { ToolCall } from '../types/data.js';
import type { RequireTool, ForbidCall, CountConstraint } from '../types/test.js';
import type { AssertionResult } from './types.js';

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
    const matchingCalls = toolCalls.filter((tc) => tc.name === req.name);

    // Check if tool was called
    if (matchingCalls.length === 0) {
      results.push({
        passed: false,
        assertion: `Tool "${req.name}" must be called`,
        expected: 'at least 1 call',
        actual: '0 calls',
      });
      continue;
    }

    // Check count constraints
    if (req.count) {
      const countResult = assertCount(req.name, matchingCalls.length, req.count);
      if (countResult) {
        results.push(countResult);
      }
    }

    // Check args_match
    if (req.args_match) {
      for (const call of matchingCalls) {
        const argsResult = assertArgsMatch(req.name, call, req.args_match);
        results.push(...argsResult);
      }
    }

    // Check result_match
    if (req.result_match) {
      let anyMatch = false;
      for (const call of matchingCalls) {
        const resultStr = stringifyResult(call.result);
        if (new RegExp(req.result_match).test(resultStr)) {
          anyMatch = true;
          break;
        }
      }
      if (!anyMatch) {
        results.push({
          passed: false,
          assertion: `Tool "${req.name}" result must match /${req.result_match}/`,
          expected: `match /${req.result_match}/`,
          actual: matchingCalls.map((c) => stringifyResult(c.result)).join(', '),
        });
      }
    }

    // Check result_not_match
    if (req.result_not_match) {
      for (const call of matchingCalls) {
        const resultStr = stringifyResult(call.result);
        if (new RegExp(req.result_not_match).test(resultStr)) {
          results.push({
            passed: false,
            assertion: `Tool "${req.name}" result must not match /${req.result_not_match}/`,
            expected: `not match /${req.result_not_match}/`,
            actual: resultStr,
          });
        }
      }
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
        const resultStr = stringifyResult(call.result);
        shouldForbid = new RegExp(forbid.result_match).test(resultStr);
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
          actual: `called with result: ${stringifyResult(call.result)}`,
        });
      }
    }
  }

  return results;
}

function assertCount(
  toolName: string,
  count: number,
  constraint: CountConstraint
): AssertionResult | null {
  if ('exact' in constraint) {
    if (count !== constraint.exact) {
      return {
        passed: false,
        assertion: `Tool "${toolName}" count`,
        expected: `exactly ${constraint.exact}`,
        actual: `${count}`,
      };
    }
  } else {
    if (constraint.min !== undefined && count < constraint.min) {
      return {
        passed: false,
        assertion: `Tool "${toolName}" count`,
        expected: `at least ${constraint.min}`,
        actual: `${count}`,
      };
    }
    if (constraint.max !== undefined && count > constraint.max) {
      return {
        passed: false,
        assertion: `Tool "${toolName}" count`,
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

function assertArgsMatch(
  toolName: string,
  call: ToolCall,
  argsMatch: Record<string, string>
): AssertionResult[] {
  const results: AssertionResult[] = [];

  for (const [key, pattern] of Object.entries(argsMatch)) {
    const value = getNestedValue(call.args, key);
    if (value === undefined) {
      results.push({
        passed: false,
        assertion: `Tool "${toolName}" arg "${key}" must match /${pattern}/`,
        expected: `argument "${key}" present`,
        actual: 'argument not found',
      });
      continue;
    }

    const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
    if (!new RegExp(pattern).test(valueStr)) {
      results.push({
        passed: false,
        assertion: `Tool "${toolName}" arg "${key}" must match /${pattern}/`,
        expected: `match /${pattern}/`,
        actual: valueStr,
      });
    }
  }

  return results;
}

function checkArgsMatch(
  call: ToolCall,
  argsMatch: Record<string, string>
): boolean {
  for (const [key, pattern] of Object.entries(argsMatch)) {
    const value = getNestedValue(call.args, key);
    if (value === undefined) return false;
    const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
    if (!new RegExp(pattern).test(valueStr)) return false;
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

function stringifyResult(result: unknown): string {
  if (typeof result === 'string') return result;
  return JSON.stringify(result);
}
