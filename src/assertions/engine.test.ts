import { describe, it, expect } from "vitest";
import { evaluateStepAssertions } from "./engine.js";
import type { StepData, ToolCall } from "../types/data.js";

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

const makeStepData = (overrides: Partial<StepData> = {}): StepData => ({
  stepIndex: 0,
  input: { message: "" },
  toolCalls: [],
  assistantText: "",
  startTs: 1000,
  endTs: 2000,
  timings: { ttfEventMs: null, ttfToolMs: null, ttfTextMs: null },
  ...overrides,
});

describe("evaluateStepAssertions", () => {
  it("passes with empty assertions", async () => {
    const result = await evaluateStepAssertions(makeStepData(), {});
    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(0);
  });

  it("evaluates text selector", async () => {
    const stepData = makeStepData({ assistantText: "Hello Kai from TestOps" });
    const result = await evaluateStepAssertions(stepData, {
      text: { matches: ["Kai", "TestOps"] },
    });
    expect(result.passed).toBe(true);
  });

  it("evaluates tool_names selector", async () => {
    const stepData = makeStepData({
      toolCalls: [
        makeToolCall("intent_agent"),
        makeToolCall("get_project_status"),
      ],
    });
    const result = await evaluateStepAssertions(stepData, {
      tool_names: { some: { equals: "get_project_status" } },
    });
    expect(result.passed).toBe(true);
  });

  it("evaluates tools selector with count", async () => {
    const stepData = makeStepData({
      toolCalls: [makeToolCall("tool1"), makeToolCall("tool2")],
    });
    const result = await evaluateStepAssertions(stepData, {
      tools: { count: { equals: 2 } },
    });
    expect(result.passed).toBe(true);
  });

  it("evaluates response selector with durationMs", async () => {
    const stepData = makeStepData({ startTs: 1000, endTs: 6000 });
    const result = await evaluateStepAssertions(stepData, {
      response: { having: { durationMs: { max: 10000 } } },
    });
    expect(result.passed).toBe(true);
  });

  it("fails response durationMs when exceeded", async () => {
    const stepData = makeStepData({ startTs: 1000, endTs: 20000 });
    const result = await evaluateStepAssertions(stepData, {
      response: { having: { durationMs: { max: 10000 } } },
    });
    expect(result.passed).toBe(false);
  });

  it("evaluates response selector with idleMs", async () => {
    const stepData = makeStepData({
      startTs: 1000,
      endTs: 5000,
      toolCalls: [makeToolCall("t1", {}, "ok", 2000)],
    });
    // max idle gap: max(2000-1000, 5000-2000) = 3000
    const result = await evaluateStepAssertions(stepData, {
      response: { having: { idleMs: { max: 5000 } } },
    });
    expect(result.passed).toBe(true);
  });

  it("fails response idleMs when exceeded", async () => {
    const stepData = makeStepData({
      startTs: 1000,
      endTs: 20000,
      toolCalls: [],
    });
    // No tools → idle = 19000
    const result = await evaluateStepAssertions(stepData, {
      response: { having: { idleMs: { max: 10000 } } },
    });
    expect(result.passed).toBe(false);
  });

  it("evaluates response selector with raw fields via having", async () => {
    const stepData = makeStepData({
      assistantText: "Hello world",
      toolCalls: [makeToolCall("t1"), makeToolCall("t2")],
    });
    const result = await evaluateStepAssertions(stepData, {
      response: {
        having: {
          toolCalls: { count: { equals: 2 } },
          assistantText: { contains: "Hello" },
        },
      },
    });
    expect(result.passed).toBe(true);
  });

  it("evaluates multiple selectors (implicit AND)", async () => {
    const stepData = makeStepData({
      assistantText: "Here is the status",
      toolCalls: [makeToolCall("get_status")],
      startTs: 1000,
      endTs: 3000,
    });
    const result = await evaluateStepAssertions(stepData, {
      text: { matches: "status" },
      tool_names: { some: { equals: "get_status" } },
      response: { having: { durationMs: { max: 5000 } } },
    });
    expect(result.passed).toBe(true);
  });

  it("top-level or: passes when one branch passes", async () => {
    const stepData = makeStepData({
      assistantText: "Here is a draft report",
      toolCalls: [makeToolCall("generate_urls")],
    });
    const result = await evaluateStepAssertions(stepData, {
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

  it("top-level or: fails when all branches fail", async () => {
    const stepData = makeStepData({
      assistantText: "Something unexpected",
      toolCalls: [makeToolCall("random_tool")],
    });
    const result = await evaluateStepAssertions(stepData, {
      or: [
        { text: { matches: "draft" } },
        { text: { matches: "clarify" } },
      ],
    });
    expect(result.passed).toBe(false);
  });
});

describe("top-level script assertion", () => {
  it("passes when script succeeds", async () => {
    const stepData = makeStepData({ assistantText: "hello" });
    const result = await evaluateStepAssertions(stepData, { script: "true" } as any);
    expect(result.passed).toBe(true);
  });

  it("fails when script fails", async () => {
    const stepData = makeStepData({ assistantText: "hello" });
    const result = await evaluateStepAssertions(stepData, { script: "false" } as any);
    expect(result.passed).toBe(false);
  });

  it("receives step context as ANANKE", async () => {
    const stepData = makeStepData({
      assistantText: "hello world",
      toolCalls: [makeToolCall("search")],
    });
    const result = await evaluateStepAssertions(stepData, {
      script: 'echo "$ANANKE" | grep -q "hello world"',
    } as any);
    expect(result.passed).toBe(true);
  });
});

describe("unknown keys after resolution", () => {
  it("flags unresolved keys as errors", async () => {
    const stepData = makeStepData();
    const result = await evaluateStepAssertions(stepData, {
      typo_assertion: {},
    } as any);
    expect(result.passed).toBe(false);
    expect(result.results[0].assertion).toContain('Unknown assertion "typo_assertion"');
  });
});

describe("named assertions integration", () => {
  it("resolves a named assertion at the block level", async () => {
    const stepData = makeStepData({
      startTs: 1000,
      endTs: 5000,
    });
    const named = {
      fast_response: { response: { having: { durationMs: { max: 15000 } } } },
    };
    const result = await evaluateStepAssertions(
      stepData,
      { fast_response: {} } as any,
      { namedAssertions: named }
    );
    expect(result.passed).toBe(true);
  });

  it("resolves parameterized named assertions", async () => {
    const stepData = makeStepData({
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
    const result = await evaluateStepAssertions(
      stepData,
      { tool_called_n_times: { tool_name: "search", n: 2 } } as any,
      { namedAssertions: named }
    );
    expect(result.passed).toBe(true);
  });

  it("fails when parameterized assertion doesn't match", async () => {
    const stepData = makeStepData({
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
    const result = await evaluateStepAssertions(
      stepData,
      { tool_called_n_times: { tool_name: "search", n: 3 } } as any,
      { namedAssertions: named }
    );
    expect(result.passed).toBe(false);
  });

  it("combines named and built-in assertions", async () => {
    const stepData = makeStepData({
      assistantText: "Here is the status",
      startTs: 1000,
      endTs: 3000,
    });
    const named = {
      fast_response: { response: { having: { durationMs: { max: 15000 } } } },
    };
    const result = await evaluateStepAssertions(
      stepData,
      {
        fast_response: {},
        text: { matches: "status" },
      } as any,
      { namedAssertions: named }
    );
    expect(result.passed).toBe(true);
  });
});

