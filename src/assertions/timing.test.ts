import { describe, it, expect } from "vitest";
import { assertTiming } from "./timing.js";
import type { ToolCall } from "../types/data.js";

const makeToolCall = (name: string, timestamp: number): ToolCall => ({
  name,
  args: {},
  result: "ok",
  timestamp,
});

describe("assertTiming", () => {
  describe("max_duration_ms", () => {
    it("passes when duration is within limit", () => {
      const results = assertTiming(
        { startTs: 1000, endTs: 2000, toolCalls: [] },
        { max_duration_ms: 5000 }
      );
      expect(results).toHaveLength(0);
    });

    it("fails when duration exceeds limit", () => {
      const results = assertTiming(
        { startTs: 1000, endTs: 10000, toolCalls: [] },
        { max_duration_ms: 5000 }
      );
      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(false);
      expect(results[0].actual).toBe("9000ms");
    });

    it("skips check when set to false", () => {
      const results = assertTiming(
        { startTs: 1000, endTs: 10000, toolCalls: [] },
        { max_duration_ms: false }
      );
      expect(results).toHaveLength(0);
    });
  });

  describe("max_idle_ms", () => {
    it("passes when all gaps are within limit", () => {
      const toolCalls = [
        makeToolCall("tool1", 1500),
        makeToolCall("tool2", 2000),
      ];
      const results = assertTiming(
        { startTs: 1000, endTs: 2500, toolCalls },
        { max_idle_ms: 1000 }
      );
      expect(results).toHaveLength(0);
    });

    it("fails when gap between tools exceeds limit", () => {
      const toolCalls = [
        makeToolCall("tool1", 1000),
        makeToolCall("tool2", 10000),
      ];
      const results = assertTiming(
        { startTs: 1000, endTs: 10500, toolCalls },
        { max_idle_ms: 5000 }
      );
      expect(results.length).toBeGreaterThan(0);
      const gapFailure = results.find((r) =>
        r.actual?.includes('"tool1" and "tool2"')
      );
      expect(gapFailure).toBeDefined();
      expect(gapFailure?.passed).toBe(false);
    });

    it("fails when start-to-first-tool gap exceeds limit", () => {
      const toolCalls = [makeToolCall("tool1", 5000)];
      const results = assertTiming(
        { startTs: 1000, endTs: 5500, toolCalls },
        { max_idle_ms: 1000 }
      );
      const startGapFailure = results.find((r) =>
        r.actual?.includes('"start" and "tool1"')
      );
      expect(startGapFailure).toBeDefined();
      expect(startGapFailure?.actual).toContain("4000ms");
    });

    it("fails when last-tool-to-end gap exceeds limit", () => {
      const toolCalls = [makeToolCall("tool1", 1500)];
      const results = assertTiming(
        { startTs: 1000, endTs: 6000, toolCalls },
        { max_idle_ms: 1000 }
      );
      const endGapFailure = results.find((r) =>
        r.actual?.includes('"tool1" and "end"')
      );
      expect(endGapFailure).toBeDefined();
      expect(endGapFailure?.actual).toContain("4500ms");
    });

    it("checks entire duration when no tool calls", () => {
      const results = assertTiming(
        { startTs: 1000, endTs: 5000, toolCalls: [] },
        { max_idle_ms: 1000 }
      );
      expect(results).toHaveLength(1);
      expect(results[0].actual).toContain("4000ms");
      expect(results[0].actual).toContain('"start" and "end"');
    });

    it("skips check when set to false", () => {
      const results = assertTiming(
        { startTs: 1000, endTs: 10000, toolCalls: [] },
        { max_idle_ms: false }
      );
      expect(results).toHaveLength(0);
    });
  });
});
