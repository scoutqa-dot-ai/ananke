import { describe, it, expect } from "vitest";
import { mergeAssertBlocks } from "./merge.js";

describe("mergeAssertBlocks", () => {
  describe("timing inheritance", () => {
    it("uses target timing when no overrides", () => {
      const result = mergeAssertBlocks(
        { timing: { max_duration_ms: 1000, max_idle_ms: 500 } },
        undefined,
        undefined
      );
      expect(result.timing?.max_duration_ms).toBe(1000);
      expect(result.timing?.max_idle_ms).toBe(500);
    });

    it("test level overrides target level", () => {
      const result = mergeAssertBlocks(
        { timing: { max_duration_ms: 1000 } },
        { timing: { max_duration_ms: 2000 } },
        undefined
      );
      expect(result.timing?.max_duration_ms).toBe(2000);
    });

    it("turn level overrides test level", () => {
      const result = mergeAssertBlocks(
        { timing: { max_duration_ms: 1000 } },
        { timing: { max_duration_ms: 2000 } },
        { timing: { max_duration_ms: 3000 } }
      );
      expect(result.timing?.max_duration_ms).toBe(3000);
    });

    it("false disables inherited constraint", () => {
      const result = mergeAssertBlocks(
        { timing: { max_duration_ms: 1000 } },
        undefined,
        { timing: { max_duration_ms: false } }
      );
      expect(result.timing?.max_duration_ms).toBe(false);
    });
  });

  describe("text inheritance", () => {
    it("accumulates must_match from all levels", () => {
      const result = mergeAssertBlocks(
        { text: { must_match: "target" } },
        { text: { must_match: ["test1", "test2"] } },
        { text: { must_match: "turn" } }
      );
      expect(result.text?.must_match).toEqual([
        "target",
        "test1",
        "test2",
        "turn",
      ]);
    });

    it("accumulates must_not_match from all levels", () => {
      const result = mergeAssertBlocks(
        { text: { must_not_match: ["error"] } },
        { text: { must_not_match: "failed" } },
        { text: { must_not_match: ["exception"] } }
      );
      expect(result.text?.must_not_match).toEqual([
        "error",
        "failed",
        "exception",
      ]);
    });
  });

  describe("tools inheritance", () => {
    it("accumulates forbid from all levels", () => {
      const result = mergeAssertBlocks(
        { tools: { forbid: ["tool1"] } },
        { tools: { forbid: ["tool2", "tool3"] } },
        { tools: { forbid: ["tool4"] } }
      );
      expect(result.tools?.forbid).toEqual(["tool1", "tool2", "tool3", "tool4"]);
    });

    it("accumulates require from all levels", () => {
      const result = mergeAssertBlocks(
        { tools: { require: [{ name: "tool1" }] } },
        { tools: { require: [{ name: "tool2", count: { exact: 1 } }] } },
        undefined
      );
      expect(result.tools?.require).toHaveLength(2);
      expect(result.tools?.require?.[0].name).toBe("tool1");
      expect(result.tools?.require?.[1].name).toBe("tool2");
    });

    it("accumulates forbid_calls from all levels", () => {
      const result = mergeAssertBlocks(
        { tools: { forbid_calls: [{ name: "tool1", args_match: { key: "val" } }] } },
        { tools: { forbid_calls: [{ name: "tool2" }] } },
        undefined
      );
      expect(result.tools?.forbid_calls).toHaveLength(2);
    });
  });

  describe("empty merges", () => {
    it("returns empty object when all levels are undefined", () => {
      const result = mergeAssertBlocks(undefined, undefined, undefined);
      expect(result.timing).toEqual({});
      expect(result.text?.must_match).toBeUndefined();
      expect(result.text?.must_not_match).toBeUndefined();
      expect(result.tools?.forbid).toBeUndefined();
    });
  });
});
