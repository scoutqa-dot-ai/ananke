import type { ExpectBlock } from "../types/test.js";
import { SELECTOR_KEYS } from "./selectors.js";

export type NamedAssertions = Record<string, unknown>;

/** All built-in operator and meta keys recognized by the evaluator */
const BUILTIN_KEYS = new Set([
  // String / Array
  "equals", "contains", "starts_with", "ends_with", "matches",
  // Number
  "min", "max",
  // Array
  "count", "every", "some", "none", "ordered", "filter",
  // Object
  "has_key", "having",
  // Transform
  "json",
  // Meta
  "and", "or", "not",
  // Script
  "script",
]);

/** Keys recognized at the assert block level (selectors + meta) */
const EXPECT_BLOCK_KEYS = new Set([
  ...SELECTOR_KEYS,
  "or", "and", "not", "script",
]);

/**
 * Validate that named assertions don't shadow built-in operators or selectors.
 * Throws at load time if a conflict is found.
 */
export function validateNamedAssertions(named: NamedAssertions): void {
  for (const name of Object.keys(named)) {
    if (BUILTIN_KEYS.has(name)) {
      throw new Error(
        `Named assertion "${name}" shadows built-in operator. Choose a different name.`
      );
    }
    if (EXPECT_BLOCK_KEYS.has(name)) {
      throw new Error(
        `Named assertion "${name}" shadows built-in selector. Choose a different name.`
      );
    }
  }
}

/**
 * Resolve named assertions in an assert block.
 * Expands named assertion references into their definitions with parameter substitution.
 * Returns a new assert block with only built-in keys.
 */
export function resolveExpectBlock(
  block: ExpectBlock,
  named: NamedAssertions
): ExpectBlock {
  const resolved: ExpectBlock = {};

  for (const [key, value] of Object.entries(block)) {
    if (EXPECT_BLOCK_KEYS.has(key)) {
      // Built-in key — resolve recursively within its value
      if (key === "or" && Array.isArray(value)) {
        resolved[key] = value.map((branch: ExpectBlock) =>
          resolveExpectBlock(branch, named)
        );
      } else if (key === "and" && Array.isArray(value)) {
        resolved[key] = value.map((branch: ExpectBlock) =>
          resolveExpectBlock(branch, named)
        );
      } else if (key === "not" && typeof value === "object" && value !== null) {
        resolved[key] = resolveExpectBlock(value as ExpectBlock, named);
      } else if (SELECTOR_KEYS.includes(key as typeof SELECTOR_KEYS[number])) {
        // Selector value is an assertion node — resolve it
        resolved[key] = resolveAssertionNode(value as Record<string, unknown>, named);
      } else {
        resolved[key] = value;
      }
    } else if (key in named) {
      // Named assertion reference — expand it
      const definition = named[key];
      const params = typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
      const expanded = substituteParams(definition, params);
      // Merge the expanded definition into the resolved block
      const expandedBlock = typeof expanded === "object" && expanded !== null
        ? resolveExpectBlock(expanded as ExpectBlock, named)
        : {} as ExpectBlock;
      for (const [ek, ev] of Object.entries(expandedBlock)) {
        if (ek in resolved) {
          // Key collision: wrap both in implicit AND
          const existing = resolved[ek];
          const mergedAnd = (resolved._mergedAnd ?? []) as ExpectBlock[];
          mergedAnd.push({ [ek]: existing }, { [ek]: ev });
          resolved._mergedAnd = mergedAnd;
          delete resolved[ek];
        } else {
          resolved[ek] = ev;
        }
      }
    } else {
      // Unknown key — pass through (evaluator will error on it)
      resolved[key] = value;
    }
  }

  // If we had key collisions, merge them into an `and` block
  if (resolved._mergedAnd) {
    const mergedBranches = resolved._mergedAnd as ExpectBlock[];
    delete resolved._mergedAnd;
    if (!resolved.and) {
      resolved.and = mergedBranches;
    } else {
      (resolved.and as ExpectBlock[]).push(...mergedBranches);
    }
  }

  return resolved;
}

/**
 * Resolve named assertions within an assertion node (recursively).
 */
export function resolveAssertionNode(
  node: Record<string, unknown>,
  named: NamedAssertions
): Record<string, unknown> {
  if (typeof node !== "object" || node === null) return node;

  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(node)) {
    if (BUILTIN_KEYS.has(key)) {
      // Built-in operator — resolve its children
      resolved[key] = resolveOperatorValue(key, value, named);
    } else if (key in named) {
      // Named assertion reference inside a node
      const definition = named[key];
      const params = typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
      const expanded = substituteParams(definition, params);
      const expandedNode = typeof expanded === "object" && expanded !== null
        ? resolveAssertionNode(expanded as Record<string, unknown>, named)
        : {};
      Object.assign(resolved, expandedNode);
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

/**
 * Resolve children of a built-in operator based on its expected shape.
 */
function resolveOperatorValue(
  key: string,
  value: unknown,
  named: NamedAssertions
): unknown {
  switch (key) {
    // Operators whose value is an assertion node
    case "count":
    case "every":
    case "some":
    case "none":
    case "filter":
    case "json":
    case "not":
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        return resolveAssertionNode(value as Record<string, unknown>, named);
      }
      return value;

    // Array of assertion nodes
    case "ordered":
    case "and":
      if (Array.isArray(value)) {
        return value.map((item) =>
          typeof item === "object" && item !== null
            ? resolveAssertionNode(item as Record<string, unknown>, named)
            : item
        );
      }
      return value;

    case "or":
      if (Array.isArray(value)) {
        return value.map((item) =>
          typeof item === "object" && item !== null
            ? resolveAssertionNode(item as Record<string, unknown>, named)
            : item
        );
      }
      return value;

    // having: Record<dotpath, assertion node>
    case "having":
      if (typeof value === "object" && value !== null) {
        const result: Record<string, unknown> = {};
        for (const [dotPath, assertNode] of Object.entries(
          value as Record<string, unknown>
        )) {
          if (typeof assertNode === "object" && assertNode !== null && !Array.isArray(assertNode)) {
            result[dotPath] = resolveAssertionNode(
              assertNode as Record<string, unknown>,
              named
            );
          } else {
            result[dotPath] = assertNode;
          }
        }
        return result;
      }
      return value;

    // Leaf operators (equals, contains, min, max, etc.) — value is a primitive
    default:
      return value;
  }
}

/**
 * Substitute ${param} placeholders in a definition with provided values.
 * Works recursively through objects, arrays, and strings.
 */
function substituteParams(
  template: unknown,
  params: Record<string, unknown>
): unknown {
  if (typeof template === "string") {
    // Check if the entire string is a single ${param} reference
    const fullMatch = template.match(/^\$\{(\w+)\}$/);
    if (fullMatch) {
      const paramName = fullMatch[1];
      if (paramName in params) {
        return params[paramName];
      }
      throw new Error(`Unresolved parameter: \${${paramName}}`);
    }
    // Replace inline ${param} references (result is always string)
    return template.replace(/\$\{(\w+)\}/g, (match, paramName) => {
      if (paramName in params) {
        return String(params[paramName]);
      }
      throw new Error(`Unresolved parameter: \${${paramName}}`);
    });
  }
  if (Array.isArray(template)) {
    return template.map((item) => substituteParams(item, params));
  }
  if (typeof template === "object" && template !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template as Record<string, unknown>)) {
      result[key] = substituteParams(value, params);
    }
    return result;
  }
  return template;
}
