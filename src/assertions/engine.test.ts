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
      text: { matches: ["Kai", "TestOps"] },
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
      tools: { count: { equals: 2 } },
    });
    expect(result.passed).toBe(true);
  });

  it("evaluates response selector with durationMs", () => {
    const turnData = makeTurnData({ startTs: 1000, endTs: 6000 });
    const result = evaluateTurnAssertions(turnData, {
      response: { having: { durationMs: { max: 10000 } } },
    });
    expect(result.passed).toBe(true);
  });

  it("fails response durationMs when exceeded", () => {
    const turnData = makeTurnData({ startTs: 1000, endTs: 20000 });
    const result = evaluateTurnAssertions(turnData, {
      response: { having: { durationMs: { max: 10000 } } },
    });
    expect(result.passed).toBe(false);
  });

  it("evaluates response selector with idleMs", () => {
    const turnData = makeTurnData({
      startTs: 1000,
      endTs: 5000,
      toolCalls: [makeToolCall("t1", {}, "ok", 2000)],
    });
    // max idle gap: max(2000-1000, 5000-2000) = 3000
    const result = evaluateTurnAssertions(turnData, {
      response: { having: { idleMs: { max: 5000 } } },
    });
    expect(result.passed).toBe(true);
  });

  it("fails response idleMs when exceeded", () => {
    const turnData = makeTurnData({
      startTs: 1000,
      endTs: 20000,
      toolCalls: [],
    });
    // No tools → idle = 19000
    const result = evaluateTurnAssertions(turnData, {
      response: { having: { idleMs: { max: 10000 } } },
    });
    expect(result.passed).toBe(false);
  });

  it("evaluates response selector with raw fields via having", () => {
    const turnData = makeTurnData({
      assistantText: "Hello world",
      toolCalls: [makeToolCall("t1"), makeToolCall("t2")],
    });
    const result = evaluateTurnAssertions(turnData, {
      response: {
        having: {
          toolCalls: { count: { equals: 2 } },
          assistantText: { contains: "Hello" },
        },
      },
    });
    expect(result.passed).toBe(true);
  });

  it("evaluates multiple selectors (implicit AND)", () => {
    const turnData = makeTurnData({
      assistantText: "Here is the status",
      toolCalls: [makeToolCall("get_status")],
      startTs: 1000,
      endTs: 3000,
    });
    const result = evaluateTurnAssertions(turnData, {
      text: { matches: "status" },
      tool_names: { some: { equals: "get_status" } },
      response: { having: { durationMs: { max: 5000 } } },
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
          text: { matches: "draft|report" },
          tool_names: { some: { matches: "generate_urls" } },
        },
        {
          text: { matches: "clarif|which|specify" },
          tools: { count: { equals: 0 } },
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
        { text: { matches: "draft" } },
        { text: { matches: "clarify" } },
      ],
    });
    expect(result.passed).toBe(false);
  });
});

describe("top-level script assertion", () => {
  it("passes when script succeeds", () => {
    const turnData = makeTurnData({ assistantText: "hello" });
    const result = evaluateTurnAssertions(turnData, { script: "true" } as any);
    expect(result.passed).toBe(true);
  });

  it("fails when script fails", () => {
    const turnData = makeTurnData({ assistantText: "hello" });
    const result = evaluateTurnAssertions(turnData, { script: "false" } as any);
    expect(result.passed).toBe(false);
  });

  it("receives turn context as ASSERT_VALUE", () => {
    const turnData = makeTurnData({
      assistantText: "hello world",
      toolCalls: [makeToolCall("search")],
    });
    const result = evaluateTurnAssertions(turnData, {
      script: 'echo "$ASSERT_VALUE" | grep -q "hello world"',
    } as any);
    expect(result.passed).toBe(true);
  });
});

describe("unknown keys after resolution", () => {
  it("flags unresolved keys as errors", () => {
    const turnData = makeTurnData();
    const result = evaluateTurnAssertions(turnData, {
      typo_assertion: {},
    } as any);
    expect(result.passed).toBe(false);
    expect(result.results[0].assertion).toContain('Unknown assertion "typo_assertion"');
  });
});

describe("named assertions integration", () => {
  it("resolves a named assertion at the block level", () => {
    const turnData = makeTurnData({
      startTs: 1000,
      endTs: 5000,
    });
    const named = {
      fast_response: { duration_ms: { max: 15000 } },
    };
    const result = evaluateTurnAssertions(
      turnData,
      { fast_response: {} } as any,
      named
    );
    expect(result.passed).toBe(true);
  });

  it("resolves parameterized named assertions", () => {
    const turnData = makeTurnData({
      toolCalls: [
        makeToolCall("search"),
        makeToolCall("search"),
        makeToolCall("lookup"),
      ],
    });
    const named = {
      tool_called_n_times: {
        tools: {
          filter: { having: { name: { equals: "${tool_name}" } } },
          count: { equals: "${n}" },
        },
      },
    };
    const result = evaluateTurnAssertions(
      turnData,
      { tool_called_n_times: { tool_name: "search", n: 2 } } as any,
      named
    );
    expect(result.passed).toBe(true);
  });

  it("fails when parameterized assertion doesn't match", () => {
    const turnData = makeTurnData({
      toolCalls: [makeToolCall("search")],
    });
    const named = {
      tool_called_n_times: {
        tools: {
          filter: { having: { name: { equals: "${tool_name}" } } },
          count: { equals: "${n}" },
        },
      },
    };
    const result = evaluateTurnAssertions(
      turnData,
      { tool_called_n_times: { tool_name: "search", n: 3 } } as any,
      named
    );
    expect(result.passed).toBe(false);
  });

  it("combines named and built-in assertions", () => {
    const turnData = makeTurnData({
      assistantText: "Here is the status",
      startTs: 1000,
      endTs: 3000,
    });
    const named = {
      fast_response: { duration_ms: { max: 15000 } },
    };
    const result = evaluateTurnAssertions(
      turnData,
      {
        fast_response: {},
        text: { matches: "status" },
      } as any,
      named
    );
    expect(result.passed).toBe(true);
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
      text: { matches: "Hello" },
      tool_names: { count: { equals: 2 } },
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
      text: { matches: "Hello\\nWorld" },
    });
    expect(result.passed).toBe(true);
  });
});
