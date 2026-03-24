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
        { text: { must_match: "hello" } },
        undefined
      );
      expect(result.text).toEqual({ must_match: "hello" });
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
        { text: { must_match: "target" } },
        { text: { must_match: "test" } },
        { text: { must_match: "turn" } }
      );
      expect(result.text).toEqual({
        and: [
          { must_match: "target" },
          { must_match: "test" },
          { must_match: "turn" },
        ],
      });
    });

    it("preserves single selector without wrapping", () => {
      const result = mergeAssertBlocks(
        undefined,
        undefined,
        { tools: { count: { exact: 0 } } }
      );
      expect(result.tools).toEqual({ count: { exact: 0 } });
    });
  });

  describe("different selectors from different levels", () => {
    it("merges different selectors from different levels", () => {
      const result = mergeAssertBlocks(
        { duration_ms: { max: 30000 } },
        { text: { must_match: "hello" } },
        { tools: { count: { min: 1 } } }
      );
      expect(result.duration_ms).toEqual({ max: 30000 });
      expect(result.text).toEqual({ must_match: "hello" });
      expect(result.tools).toEqual({ count: { min: 1 } });
    });
  });

  describe("top-level meta", () => {
    it("accumulates or from multiple levels as and branches", () => {
      const result = mergeAssertBlocks(
        {
          or: [
            { text: { must_match: "a" } },
            { text: { must_match: "b" } },
          ],
        },
        {
          or: [
            { tools: { count: { exact: 0 } } },
            { tools: { count: { min: 1 } } },
          ],
        },
        undefined
      );
      expect(result.and).toHaveLength(2);
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
