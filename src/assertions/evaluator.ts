import type { AssertionResult, EvalContext } from "./types.js";
import {
  matchesPattern,
  getNestedValue,
  stringify,
  truncate,
  typeOf,
} from "./utils.js";

/** An assertion node is a plain object with operator keys */
export type AssertionNode = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pass(
  assertion: string,
  ctx: EvalContext
): AssertionResult {
  const result: AssertionResult = { passed: true, assertion, path: ctx.path };
  ctx.logger?.debug(`[assert] ${ctx.path.join(" → ")}: PASSED`);
  return result;
}

function fail(
  assertion: string,
  ctx: EvalContext,
  opts: { expected?: string; actual?: string; details?: string } = {}
): AssertionResult {
  const result: AssertionResult = { passed: false, assertion, path: ctx.path, ...opts };
  const hasExpected = opts.expected !== undefined;
  const hasActual = opts.actual !== undefined;
  const detail = hasExpected && hasActual
    ? ` (expected: ${opts.expected}, got: ${opts.actual || "(empty)"})`
    : hasExpected
      ? ` (expected: ${opts.expected})`
      : hasActual
        ? ` (got: ${opts.actual || "(empty)"})`
        : "";
  ctx.logger?.debug(`[assert] ${ctx.path.join(" → ")}: FAILED — ${assertion}${detail}`);
  return result;
}

function typeMismatch(
  operator: string,
  expectedType: string,
  value: unknown,
  ctx: EvalContext,
  hint?: string
): AssertionResult {
  const details = hint
    ? `hint: ${hint}`
    : undefined;
  return fail(
    `"${operator}" expects ${expectedType} but got ${typeOf(value)}`,
    ctx,
    {
      actual: truncate(stringify(value)),
      details,
    }
  );
}

function normalizeToArray(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  return [value as string];
}

/** Create a child context with an extended path */
function child(ctx: EvalContext, ...segments: string[]): EvalContext {
  return { ...ctx, path: [...ctx.path, ...segments] };
}

// ---------------------------------------------------------------------------
// Main evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate an assertion node against a value.
 * Returns all failures (implicit AND across sibling keys).
 */
export async function evaluate(
  value: unknown,
  node: AssertionNode,
  ctx: EvalContext
): Promise<AssertionResult[]> {
  const results: AssertionResult[] = [];
  const keys = Object.keys(node);

  // Special handling: if `filter` is a sibling key on an array, apply it first
  // and replace the value for the remaining sibling assertions.
  let effectiveValue = value;
  if ("filter" in node && Array.isArray(value)) {
    const filterNode = node.filter as AssertionNode;
    const filtered: unknown[] = [];
    for (const element of value as unknown[]) {
      const filterResults = await evaluate(
        element,
        filterNode,
        child(ctx, "filter")
      );
      if (filterResults.every((r) => r.passed)) {
        filtered.push(element);
      }
    }
    effectiveValue = filtered;
  }

  for (const key of keys) {
    if (key === "filter" && Array.isArray(value)) continue; // already handled
    const operand = node[key];
    const childCtx = child(ctx, key);

    switch (key) {
      // --- String / Array assertions ---
      case "equals":
        results.push(evalEquals(effectiveValue, operand, childCtx));
        break;
      case "contains":
        results.push(await evalContains(effectiveValue, operand, childCtx));
        break;
      case "starts_with":
        results.push(evalStartsWith(effectiveValue, operand as string, childCtx));
        break;
      case "ends_with":
        results.push(evalEndsWith(effectiveValue, operand as string, childCtx));
        break;
      case "matches":
        results.push(...evalMatches(effectiveValue, operand, childCtx));
        break;

      // --- Number assertions ---
      case "min":
        results.push(evalMin(effectiveValue, operand as number, childCtx));
        break;
      case "max":
        results.push(evalMax(effectiveValue, operand as number, childCtx));
        break;

      // --- Array assertions ---
      case "count":
        results.push(...await evalCount(effectiveValue, operand as AssertionNode, childCtx));
        break;
      case "every":
        results.push(...await evalEvery(effectiveValue, operand as AssertionNode, childCtx));
        break;
      case "some":
        results.push(...await evalSome(effectiveValue, operand as AssertionNode, childCtx));
        break;
      case "none":
        results.push(...await evalNone(effectiveValue, operand as AssertionNode, childCtx));
        break;
      case "ordered":
        results.push(...await evalOrdered(effectiveValue, operand as AssertionNode[], childCtx));
        break;
      case "filter":
        // filter on non-array is a type mismatch
        if (!Array.isArray(value)) {
          results.push(typeMismatch("filter", "array", effectiveValue, childCtx));
        }
        break;

      // --- Object assertions ---
      case "has_key":
        results.push(evalHasKey(effectiveValue, operand as string, childCtx));
        break;

      // --- Transforms ---
      case "having":
        results.push(...await evalHaving(
          effectiveValue,
          operand as Record<string, AssertionNode>,
          childCtx
        ));
        break;
      case "json":
        results.push(...await evalJson(effectiveValue, operand as AssertionNode, childCtx));
        break;

      // --- Meta ---
      case "and":
        results.push(...await evalAnd(effectiveValue, operand as AssertionNode[], childCtx));
        break;
      case "or":
        results.push(...await evalOr(effectiveValue, operand as AssertionNode[], childCtx));
        break;
      case "not":
        results.push(...await evalNot(effectiveValue, operand as AssertionNode, childCtx));
        break;

      // --- Script ---
      case "script":
        results.push(await evalScript(effectiveValue, operand, childCtx));
        break;

      default:
        results.push(fail(`Unknown assertion operator "${key}"`, childCtx));
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// String / Array assertions
// ---------------------------------------------------------------------------

function evalEquals(
  value: unknown,
  expected: unknown,
  ctx: EvalContext
): AssertionResult {
  // equals works for string, number, boolean, null
  if (value === expected) {
    return pass("equals", ctx);
  }
  return fail("equals", ctx, {
    expected: stringify(expected),
    actual: truncate(stringify(value)),
  });
}

async function evalContains(
  value: unknown,
  expected: unknown,
  ctx: EvalContext
): Promise<AssertionResult> {
  // Array: sugar for some: { equals: expected }
  if (Array.isArray(value)) {
    const someResults = await evalSome(value, { equals: expected }, ctx);
    if (someResults.length === 0) {
      return pass("contains", ctx);
    }
    return fail("contains", ctx, {
      expected: `array contains ${stringify(expected)}`,
      actual: `not found in array of ${value.length}`,
    });
  }
  // String: substring check
  if (typeof value !== "string") {
    return typeMismatch("contains", "string or array", value, ctx);
  }
  if (typeof expected !== "string") {
    return typeMismatch("contains", "string operand for string value", expected, ctx);
  }
  if (value.includes(expected)) {
    return pass("contains", ctx);
  }
  return fail("contains", ctx, {
    expected: `contains "${expected}"`,
    actual: truncate(value),
  });
}

function evalStartsWith(
  value: unknown,
  expected: string,
  ctx: EvalContext
): AssertionResult {
  if (typeof value !== "string") {
    return typeMismatch("starts_with", "string", value, ctx);
  }
  if (value.startsWith(expected)) {
    return pass("starts_with", ctx);
  }
  return fail("starts_with", ctx, {
    expected: `starts with "${expected}"`,
    actual: truncate(value),
  });
}

function evalEndsWith(
  value: unknown,
  expected: string,
  ctx: EvalContext
): AssertionResult {
  if (typeof value !== "string") {
    return typeMismatch("ends_with", "string", value, ctx);
  }
  if (value.endsWith(expected)) {
    return pass("ends_with", ctx);
  }
  return fail("ends_with", ctx, {
    expected: `ends with "${expected}"`,
    actual: truncate(value),
  });
}

function evalMatches(
  value: unknown,
  patterns: unknown,
  ctx: EvalContext
): AssertionResult[] {
  if (typeof value !== "string") {
    return [
      typeMismatch(
        "matches",
        "string",
        value,
        ctx,
        'use "equals" for non-string values'
      ),
    ];
  }
  const results: AssertionResult[] = [];
  for (const pattern of normalizeToArray(patterns)) {
    if (matchesPattern(value, pattern)) {
      results.push(pass("matches", ctx));
    } else {
      results.push(
        fail("matches", ctx, {
          expected: `match /${pattern}/`,
          actual: truncate(value),
        })
      );
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Number assertions
// ---------------------------------------------------------------------------

function evalMin(
  value: unknown,
  expected: number,
  ctx: EvalContext
): AssertionResult {
  if (typeof value !== "number") {
    return typeMismatch("min", "number", value, ctx);
  }
  if (value >= expected) {
    return pass("min", ctx);
  }
  return fail("min", ctx, {
    expected: `>= ${expected}`,
    actual: `${value}`,
  });
}

function evalMax(
  value: unknown,
  expected: number,
  ctx: EvalContext
): AssertionResult {
  if (typeof value !== "number") {
    return typeMismatch("max", "number", value, ctx);
  }
  if (value <= expected) {
    return pass("max", ctx);
  }
  return fail("max", ctx, {
    expected: `<= ${expected}`,
    actual: `${value}`,
  });
}

// ---------------------------------------------------------------------------
// Array assertions
// ---------------------------------------------------------------------------

async function evalCount(
  value: unknown,
  node: AssertionNode,
  ctx: EvalContext
): Promise<AssertionResult[]> {
  if (!Array.isArray(value)) {
    return [typeMismatch("count", "array", value, ctx)];
  }
  // Evaluate number assertions on the length
  return evaluate(value.length, node, ctx);
}

async function evalEvery(
  value: unknown,
  node: AssertionNode,
  ctx: EvalContext
): Promise<AssertionResult[]> {
  if (!Array.isArray(value)) {
    return [typeMismatch("every", "array", value, ctx)];
  }
  // Vacuous truth: empty array passes
  const results: AssertionResult[] = [];
  for (let i = 0; i < value.length; i++) {
    const elementResults = await evaluate(value[i], node, child(ctx, `[${i}]`));
    const failures = elementResults.filter((r) => !r.passed);
    if (failures.length > 0) {
      results.push(...failures);
    }
  }
  return results;
}

async function evalSome(
  value: unknown,
  node: AssertionNode,
  ctx: EvalContext
): Promise<AssertionResult[]> {
  if (!Array.isArray(value)) {
    return [typeMismatch("some", "array", value, ctx)];
  }
  if (value.length === 0) {
    return [
      fail("some", ctx, {
        expected: "at least one element matching",
        actual: "empty array",
      }),
    ];
  }
  const allElementFailures: AssertionResult[] = [];
  for (let i = 0; i < value.length; i++) {
    const elementResults = await evaluate(value[i], node, child(ctx, `[${i}]`));
    const failures = elementResults.filter((r) => !r.passed);
    if (failures.length === 0) {
      return []; // at least one element passed
    }
    allElementFailures.push(...failures);
  }
  const result = fail("some", ctx, {
    expected: "at least one element matching",
    actual: truncate(stringify(value), 120),
  });
  result.children = allElementFailures;
  return [result];
}

async function evalNone(
  value: unknown,
  node: AssertionNode,
  ctx: EvalContext
): Promise<AssertionResult[]> {
  if (!Array.isArray(value)) {
    return [typeMismatch("none", "array", value, ctx)];
  }
  const results: AssertionResult[] = [];
  for (let i = 0; i < value.length; i++) {
    const elementResults = await evaluate(value[i], node, child(ctx, `[${i}]`));
    const failures = elementResults.filter((r) => !r.passed);
    if (failures.length === 0) {
      // This element passed the assertion — which means it shouldn't have
      results.push(
        fail("none", ctx, {
          expected: "no element matching",
          actual: `element [${i}] matched: ${truncate(stringify(value[i]))}`,
        })
      );
    }
  }
  return results;
}

async function evalOrdered(
  value: unknown,
  patterns: AssertionNode[],
  ctx: EvalContext
): Promise<AssertionResult[]> {
  if (!Array.isArray(value)) {
    return [typeMismatch("ordered", "array", value, ctx)];
  }
  // Elements matching each assertion appear in order (not necessarily adjacent)
  let searchFrom = 0;
  for (let pi = 0; pi < patterns.length; pi++) {
    const pattern = patterns[pi];
    let found = false;
    for (let i = searchFrom; i < value.length; i++) {
      const elementResults = await evaluate(value[i], pattern, ctx);
      const failures = elementResults.filter((r) => !r.passed);
      if (failures.length === 0) {
        searchFrom = i + 1;
        found = true;
        break;
      }
    }
    if (!found) {
      return [
        fail("ordered", ctx, {
          expected: `element matching pattern [${pi}] after position ${searchFrom}`,
          actual: `not found in array of ${value.length}`,
        }),
      ];
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Object assertions
// ---------------------------------------------------------------------------

function evalHasKey(
  value: unknown,
  key: string,
  ctx: EvalContext
): AssertionResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return typeMismatch("has_key", "object", value, ctx);
  }
  if (Object.prototype.hasOwnProperty.call(value, key)) {
    return pass("has_key", ctx);
  }
  return fail("has_key", ctx, {
    expected: `key "${key}" exists`,
    actual: `keys: ${Object.keys(value).join(", ")}`,
  });
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

async function evalHaving(
  value: unknown,
  fields: Record<string, AssertionNode>,
  ctx: EvalContext
): Promise<AssertionResult[]> {
  if (typeof value !== "object" || value === null) {
    return [typeMismatch("having", "object", value, ctx)];
  }
  const results: AssertionResult[] = [];
  for (const [dotPath, assertNode] of Object.entries(fields)) {
    const result = getNestedValue(value, dotPath);
    if (!result.found) {
      results.push(
        fail("having", child(ctx, dotPath), {
          expected: `path "${dotPath}" exists`,
          actual: "path not found",
        })
      );
    } else {
      results.push(
        ...await evaluate(result.value, assertNode, child(ctx, dotPath))
      );
    }
  }
  return results;
}

async function evalJson(
  value: unknown,
  node: AssertionNode,
  ctx: EvalContext
): Promise<AssertionResult[]> {
  // If the value is already parsed (e.g., tool results are eagerly JSON.parse'd
  // during event collection), skip parsing and evaluate directly.
  if (typeof value !== "string") {
    if (value !== null && value !== undefined) {
      return evaluate(value, node, ctx);
    }
    return [
      typeMismatch("json", "string or pre-parsed value", value, ctx),
    ];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [
      fail("json", ctx, {
        expected: "valid JSON string",
        actual: `invalid JSON: ${truncate(value)}`,
      }),
    ];
  }
  return evaluate(parsed, node, ctx);
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

async function evalAnd(
  value: unknown,
  branches: AssertionNode[],
  ctx: EvalContext
): Promise<AssertionResult[]> {
  // All branches must pass; report all failures
  const results: AssertionResult[] = [];
  for (const branch of branches) {
    results.push(...await evaluate(value, branch, ctx));
  }
  return results;
}

async function evalOr(
  value: unknown,
  branches: AssertionNode[],
  ctx: EvalContext
): Promise<AssertionResult[]> {
  // At least one branch must pass entirely
  const branchChildren: AssertionResult[] = [];
  for (let i = 0; i < branches.length; i++) {
    const branchCtx = child(ctx, `branch ${i + 1}`);
    const branchResults = await evaluate(value, branches[i], branchCtx);
    const failures = branchResults.filter((r) => !r.passed);
    if (failures.length === 0) {
      return []; // this branch passed
    }
    branchChildren.push(...failures);
  }
  // All branches failed — attach each branch's failures as children
  const result = fail("or", ctx, {
    expected: "at least one branch to pass",
    actual: `all ${branches.length} branches failed`,
  });
  result.children = branchChildren;
  return [result];
}

async function evalNot(
  value: unknown,
  node: AssertionNode,
  ctx: EvalContext
): Promise<AssertionResult[]> {
  const innerResults = await evaluate(value, node, ctx);
  const failures = innerResults.filter((r) => !r.passed);
  if (failures.length > 0) {
    // Inner assertion failed → `not` passes
    return [];
  }
  // Inner assertion passed → `not` fails
  return [
    fail("not", ctx, {
      expected: "assertion to fail",
      actual: "assertion passed",
    }),
  ];
}

// ---------------------------------------------------------------------------
// Script (delegates to shared executor via EvalContext.scriptRunner)
// ---------------------------------------------------------------------------

async function evalScript(
  value: unknown,
  operand: unknown,
  ctx: EvalContext
): Promise<AssertionResult> {
  if (!ctx.scriptRunner) {
    return fail("script", ctx, {
      expected: "script runner configured",
      actual: "no scriptRunner in EvalContext — cannot run script assertions",
    });
  }

  return ctx.scriptRunner(value, operand, ctx);
}
