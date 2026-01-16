import type { AssertBlock, TimingAssert, TextAssert, ToolsAssert } from "../types/test.js";
import type { ConfigAssertBlock } from "../types/config.js";

/**
 * Normalize a value to an array
 */
function normalizeToArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Merge timing assertions (scalars override, false disables)
 */
function mergeTimingAssert(
  ...levels: (TimingAssert | undefined)[]
): TimingAssert {
  const merged: TimingAssert = {};
  for (const level of levels) {
    if (level?.max_duration_ms !== undefined) {
      merged.max_duration_ms = level.max_duration_ms;
    }
    if (level?.max_idle_ms !== undefined) {
      merged.max_idle_ms = level.max_idle_ms;
    }
  }
  return merged;
}

/**
 * Merge text assertions (arrays extend/accumulate)
 */
function mergeTextAssert(
  ...levels: (TextAssert | undefined)[]
): TextAssert {
  const mustMatch: string[] = [];
  const mustNotMatch: string[] = [];

  for (const level of levels) {
    if (level?.must_match) {
      mustMatch.push(...normalizeToArray(level.must_match));
    }
    if (level?.must_not_match) {
      mustNotMatch.push(...normalizeToArray(level.must_not_match));
    }
  }

  return {
    must_match: mustMatch.length > 0 ? mustMatch : undefined,
    must_not_match: mustNotMatch.length > 0 ? mustNotMatch : undefined,
  };
}

/**
 * Merge tool assertions (arrays extend/accumulate)
 */
function mergeToolsAssert(
  ...levels: (ToolsAssert | undefined)[]
): ToolsAssert {
  const forbid: string[] = [];
  const require: ToolsAssert["require"] = [];
  const forbidCalls: ToolsAssert["forbid_calls"] = [];

  for (const level of levels) {
    if (level?.forbid) {
      forbid.push(...level.forbid);
    }
    if (level?.require) {
      require.push(...level.require);
    }
    if (level?.forbid_calls) {
      forbidCalls.push(...level.forbid_calls);
    }
  }

  return {
    forbid: forbid.length > 0 ? forbid : undefined,
    require: require.length > 0 ? require : undefined,
    forbid_calls: forbidCalls.length > 0 ? forbidCalls : undefined,
  };
}

/**
 * Merge assertion blocks from target -> test -> turn
 * - Scalars (timing values): Higher level overrides lower
 * - false: Disables the inherited constraint
 * - Arrays (forbid, require, must_match): Extend (accumulate from all levels)
 */
export function mergeAssertBlocks(
  target: ConfigAssertBlock | undefined,
  test: AssertBlock | undefined,
  turn: AssertBlock | undefined
): AssertBlock {
  return {
    tools: mergeToolsAssert(target?.tools, test?.tools, turn?.tools),
    timing: mergeTimingAssert(target?.timing, test?.timing, turn?.timing),
    text: mergeTextAssert(target?.text, test?.text, turn?.text),
  };
}
