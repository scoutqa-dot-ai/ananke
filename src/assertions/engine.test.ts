import { describe, it, expect } from "vitest";
import { evaluateTurnAssertions, evaluateTestAssertions } from "./engine.js";
import type { TurnData, TestData, ToolCall } from "../types/data.js";

const makeToolCall = (
  name: string,
  args: Record<string, unknown> = {},
  result: unknown = "ok",
  timestamp = Date.now()
): ToolCall => ({
  name,
  args,
  result,
  timestamp,
});

const makeTurnData = (overrides: Partial<TurnData> = {}): TurnData => ({
  turnIndex: 0,
  toolCalls: [],
  assistantText: "",
  startTs: 1000,
  endTs: 2000,
  ...overrides,
});

describe("evaluateTurnAssertions", () => {
  it("passes with empty assertions", () => {
    const result = evaluateTurnAssertions(makeTurnData(), {});
    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(0);
  });

  it("evaluates text selector", () => {
    const turnData = makeTurnData({ assistantText: "Hello Kai from TestOps" });
    const result = evaluateTurnAssertions(turnData, {
      text: { must_match: ["Kai", "TestOps"] },
    });
    expect(result.passed).toBe(true);
  });

  it("evaluates tool_names selector", () => {
    const turnData = makeTurnData({
      toolCalls: [
        makeToolCall("intent_agent"),
        makeToolCall("get_project_status"),
      ],
    });
    const result = evaluateTurnAssertions(turnData, {
      tool_names: { some: { equals: "get_project_status" } },
    });
    expect(result.passed).toBe(true);
  });

  it("evaluates tools selector with count", () => {
    const turnData = makeTurnData({
      toolCalls: [makeToolCall("tool1"), makeToolCall("tool2")],
    });
    const result = evaluateTurnAssertions(turnData, {
      tools: { count: { exact: 2 } },
    });
    expect(result.passed).toBe(true);
  });

  it("evaluates duration_ms selector", () => {
    const turnData = makeTurnData({ startTs: 1000, endTs: 6000 });
    const result = evaluateTurnAssertions(turnData, {
      duration_ms: { max: 10000 },
    });
    expect(result.passed).toBe(true);
  });

  it("fails duration_ms when exceeded", () => {
    const turnData = makeTurnData({ startTs: 1000, endTs: 20000 });
    const result = evaluateTurnAssertions(turnData, {
      duration_ms: { max: 10000 },
    });
    expect(result.passed).toBe(false);
  });

  it("evaluates idle_ms selector", () => {
    const turnData = makeTurnData({
      startTs: 1000,
      endTs: 5000,
      toolCalls: [makeToolCall("t1", {}, "ok", 2000)],
    });
    // max idle gap: max(2000-1000, 5000-2000) = 3000
    const result = evaluateTurnAssertions(turnData, {
      idle_ms: { max: 5000 },
    });
    expect(result.passed).toBe(true);
  });

  it("fails idle_ms when exceeded", () => {
    const turnData = makeTurnData({
      startTs: 1000,
      endTs: 20000,
      toolCalls: [],
    });
    // No tools → idle = 19000
    const result = evaluateTurnAssertions(turnData, {
      idle_ms: { max: 10000 },
    });
    expect(result.passed).toBe(false);
  });

  it("evaluates multiple selectors (implicit AND)", () => {
    const turnData = makeTurnData({
      assistantText: "Here is the status",
      toolCalls: [makeToolCall("get_status")],
      startTs: 1000,
      endTs: 3000,
    });
    const result = evaluateTurnAssertions(turnData, {
      text: { must_match: "status" },
      tool_names: { some: { equals: "get_status" } },
      duration_ms: { max: 5000 },
    });
    expect(result.passed).toBe(true);
  });

  it("top-level or: passes when one branch passes", () => {
    const turnData = makeTurnData({
      assistantText: "Here is a draft report",
      toolCalls: [makeToolCall("generate_urls")],
    });
    const result = evaluateTurnAssertions(turnData, {
      or: [
        {
          text: { must_match: "draft|report" },
          tool_names: { some: { must_match: "generate_urls" } },
        },
        {
          text: { must_match: "clarif|which|specify" },
          tools: { count: { exact: 0 } },
        },
      ],
    });
    expect(result.passed).toBe(true);
  });

  it("top-level or: fails when all branches fail", () => {
    const turnData = makeTurnData({
      assistantText: "Something unexpected",
      toolCalls: [makeToolCall("random_tool")],
    });
    const result = evaluateTurnAssertions(turnData, {
      or: [
        { text: { must_match: "draft" } },
        { text: { must_match: "clarify" } },
      ],
    });
    expect(result.passed).toBe(false);
  });
});

describe("evaluateTestAssertions", () => {
  it("evaluates across all turns", () => {
    const testData: TestData = {
      turns: [
        makeTurnData({
          turnIndex: 0,
          assistantText: "Hello",
          toolCalls: [makeToolCall("t1")],
        }),
        makeTurnData({
          turnIndex: 1,
          assistantText: "World",
          toolCalls: [makeToolCall("t2")],
        }),
      ],
      allToolCalls: [makeToolCall("t1"), makeToolCall("t2")],
      allAssistantTexts: ["Hello", "World"],
      startTs: 1000,
      endTs: 5000,
    };

    const result = evaluateTestAssertions(testData, {
      text: { must_match: "Hello" },
      tool_names: { count: { exact: 2 } },
    });
    expect(result.passed).toBe(true);
  });

  it("text is joined with newline across turns", () => {
    const testData: TestData = {
      turns: [],
      allToolCalls: [],
      allAssistantTexts: ["Hello", "World"],
      startTs: 1000,
      endTs: 5000,
    };

    const result = evaluateTestAssertions(testData, {
      text: { must_match: "Hello\\nWorld" },
    });
    expect(result.passed).toBe(true);
  });
});
