import type { AssertBlock } from "../types/test.js";
import type { ConfigAssertBlock } from "../types/config.js";
import { SELECTOR_KEYS } from "../assertions/selectors.js";

/**
 * Merge assertion blocks from target -> test -> step.
 *
 * In v2, assert blocks are trees. Merging strategy:
 * - For each selector key, if multiple levels define it, wrap them in an implicit AND.
 * - Top-level meta (or/and/not) are accumulated from all levels.
 * - If only one level defines a selector, use it directly.
 */
export function mergeAssertBlocks(
  target: ConfigAssertBlock | undefined,
  test: AssertBlock | undefined,
  step: AssertBlock | undefined
): AssertBlock {
  const levels = [target, test, step].filter(
    (l): l is AssertBlock => l !== undefined && Object.keys(l).length > 0
  );

  if (levels.length === 0) return {};
  if (levels.length === 1) return levels[0];

  const merged: AssertBlock = {};

  // Merge each selector key
  for (const key of SELECTOR_KEYS) {
    const nodes = levels
      .map((l) => l[key as keyof AssertBlock])
      .filter((n) => n !== undefined);

    if (nodes.length === 0) continue;
    if (nodes.length === 1) {
      (merged as Record<string, unknown>)[key] = nodes[0];
    } else {
      // Wrap multiple nodes in an implicit AND
      (merged as Record<string, unknown>)[key] = {
        and: nodes,
      };
    }
  }

  // Accumulate top-level meta from all levels
  const andBranches: AssertBlock[] = [];

  for (const level of levels) {
    if (level.and) {
      andBranches.push(...(level.and as AssertBlock[]));
    }
    if (level.or) {
      // Each level's `or` is an independent constraint, so we AND them together
      // by treating each `or` as its own branch in the merged `and`
      andBranches.push({ or: level.or as AssertBlock[] });
    }
    if (level.not) {
      andBranches.push({ not: level.not as AssertBlock });
    }
  }

  if (andBranches.length > 0) {
    merged.and = andBranches;
  }

  // Preserve non-selector, non-meta keys (named assertions, script, etc.)
  const knownKeys = new Set([...SELECTOR_KEYS, "or", "and", "not"]);
  for (const level of levels) {
    for (const [key, value] of Object.entries(level)) {
      if (knownKeys.has(key)) continue;
      if (key in merged) {
        // Key collision across levels: wrap in AND
        andBranches.push({ [key]: merged[key] }, { [key]: value });
        delete merged[key];
        if (!merged.and) merged.and = andBranches;
      } else {
        merged[key] = value;
      }
    }
  }

  return merged;
}
