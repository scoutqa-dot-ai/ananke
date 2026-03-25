import { describe, it, expect } from "vitest";
import { mergeAssertBlocks } from "./merge.js";

describe("mergeAssertBlocks", () => {
  describe("selector inheritance", () => {
    it("uses target selector when no overrides", () => {
      const result = mergeAssertBlocks(
        { duration_ms: { max: 5000 } },
        undefined,
        undefined
      );
      expect(result.duration_ms).toEqual({ max: 5000 });
    });

    it("uses test selector when no target", () => {
      const result = mergeAssertBlocks(
        undefined,
        { text: { matches: "hello" } },
        undefined
      );
      expect(result.text).toEqual({ matches: "hello" });
    });

    it("wraps multiple levels in implicit AND for same selector", () => {
      const result = mergeAssertBlocks(
        { duration_ms: { max: 30000 } },
        { duration_ms: { max: 15000 } },
        undefined
      );
      expect(result.duration_ms).toEqual({
        and: [{ max: 30000 }, { max: 15000 }],
      });
    });

    it("merges text from all three levels", () => {
      const result = mergeAssertBlocks(
        { text: { matches: "target" } },
        { text: { matches: "test" } },
        { text: { matches: "turn" } }
      );
      expect(result.text).toEqual({
        and: [
          { matches: "target" },
          { matches: "test" },
          { matches: "turn" },
        ],
      });
    });

    it("preserves single selector without wrapping", () => {
      const result = mergeAssertBlocks(
        undefined,
        undefined,
        { tools: { count: { equals: 0 } } }
      );
      expect(result.tools).toEqual({ count: { equals: 0 } });
    });
  });

  describe("different selectors from different levels", () => {
    it("merges different selectors from different levels", () => {
      const result = mergeAssertBlocks(
        { duration_ms: { max: 30000 } },
        { text: { matches: "hello" } },
        { tools: { count: { min: 1 } } }
      );
      expect(result.duration_ms).toEqual({ max: 30000 });
      expect(result.text).toEqual({ matches: "hello" });
      expect(result.tools).toEqual({ count: { min: 1 } });
    });
  });

  describe("top-level meta", () => {
    it("accumulates or from multiple levels as and branches", () => {
      const result = mergeAssertBlocks(
        {
          or: [
            { text: { matches: "a" } },
            { text: { matches: "b" } },
          ],
        },
        {
          or: [
            { tools: { count: { equals: 0 } } },
            { tools: { count: { min: 1 } } },
          ],
        },
        undefined
      );
      expect(result.and).toHaveLength(2);
    });
  });

  describe("non-selector keys (named assertions, script)", () => {
    it("preserves named assertion keys from a single level", () => {
      const result = mergeAssertBlocks(
        undefined,
        { fast_response: {} } as any,
        undefined
      );
      expect(result.fast_response).toEqual({});
    });

    it("preserves named assertion keys across multiple levels", () => {
      const result = mergeAssertBlocks(
        { duration_ms: { max: 30000 } },
        { fast_response: {} } as any,
        { text: { matches: "hello" } }
      );
      expect(result.fast_response).toEqual({});
      expect(result.duration_ms).toBeDefined();
      expect(result.text).toBeDefined();
    });

    it("preserves script key at top level", () => {
      const result = mergeAssertBlocks(
        undefined,
        { script: "test -f output.json" } as any,
        undefined
      );
      expect(result.script).toEqual("test -f output.json");
    });
  });

  describe("empty merges", () => {
    it("returns empty object when all levels are undefined", () => {
      const result = mergeAssertBlocks(undefined, undefined, undefined);
      expect(result).toEqual({});
    });

    it("returns empty object when all levels are empty", () => {
      const result = mergeAssertBlocks({}, {}, {});
      expect(result).toEqual({});
    });
  });
});
