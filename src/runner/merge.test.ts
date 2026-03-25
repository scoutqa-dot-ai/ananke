import { describe, it, expect } from "vitest";
import { mergeAssertBlocks } from "./merge.js";

describe("mergeAssertBlocks", () => {
  describe("selector inheritance", () => {
    it("uses target selector when no overrides", () => {
      const result = mergeAssertBlocks(
        { response: { having: { durationMs: { max: 5000 } } } },
        undefined,
        undefined
      );
      expect(result.response).toEqual({ having: { durationMs: { max: 5000 } } });
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
        { response: { having: { durationMs: { max: 30000 } } } },
        { response: { having: { durationMs: { max: 15000 } } } },
        undefined
      );
      expect(result.response).toEqual({
        and: [
          { having: { durationMs: { max: 30000 } } },
          { having: { durationMs: { max: 15000 } } },
        ],
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
        { response: { having: { durationMs: { max: 30000 } } } },
        { text: { matches: "hello" } },
        { tools: { count: { min: 1 } } }
      );
      expect(result.response).toEqual({ having: { durationMs: { max: 30000 } } });
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

  describe("s9 duplication trace", () => {
    it("does not duplicate named assertion keys across levels", () => {
      const test = { fast_test: { ms: 300000 } } as any;
      const turn = {
        calls_agent: { agent: "stability_analyzer_agent" },
        fast_turn: { ms: 120000 },
      } as any;

      const merged = mergeAssertBlocks(undefined, test, turn);
      // Should have 3 distinct keys, no duplication
      const keys = Object.keys(merged);
      expect(keys).toContain("calls_agent");
      expect(keys).toContain("fast_turn");
      expect(keys).toContain("fast_test");
      // No 'and' wrapper needed — all are different keys
      expect(merged.and).toBeUndefined();
    });

    it("end-to-end: resolve after merge does not create excessive assertions", async () => {
      const { resolveAssertBlock } = await import("../assertions/resolver.js");
      const { evaluateTurnAssertions } = await import("../assertions/engine.js");

      const named = {
        fast_turn: { response: { having: { durationMs: { max: "${ms}" } } } },
        fast_test: { response: { having: { durationMs: { max: "${ms}" } } } },
        calls_agent: { tool_names: { some: { equals: "${agent}" } } },
      };

      const test = { fast_test: { ms: 300000 } } as any;
      const turn = {
        calls_agent: { agent: "stability_analyzer_agent" },
        fast_turn: { ms: 120000 },
      } as any;

      const merged = mergeAssertBlocks(undefined, test, turn);
      const resolved = resolveAssertBlock(merged, named);

      const turnData = {
        turnIndex: 0,
        toolCalls: [{ name: "stability_analyzer_agent", args: {}, result: "ok", timestamp: 1000 }],
        assistantText: "done",
        startTs: 1000,
        endTs: 2000,
      };

      const evalResult = evaluateTurnAssertions(turnData, resolved as any, {
        namedAssertions: {},
      });

      // Should have exactly: tool_names + 2 durationMs checks (fast_turn + fast_test)
      const durationResults = evalResult.results.filter(r => r.path?.join(" → ").includes("durationMs"));
      expect(durationResults).toHaveLength(2);
      expect(evalResult.passed).toBe(true);
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
