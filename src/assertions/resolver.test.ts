import { describe, it, expect } from "vitest";
import {
  resolveAssertBlock,
  resolveAssertionNode,
  validateNamedAssertions,
} from "./resolver.js";
import { NamedAssertionsSchema } from "../types/config.js";

describe("NamedAssertionsSchema", () => {
  it("accepts valid named assertions", () => {
    const result = NamedAssertionsSchema.safeParse({
      fast_response: { duration_ms: { max: 15000 } },
      calls_agent: { tool_names: { some: { equals: "agent" } } },
    });
    expect(result.success).toBe(true);
  });

  it("accepts ${param} placeholders in number positions", () => {
    const result = NamedAssertionsSchema.safeParse({
      completes_within: { duration_ms: { max: "${ms}" } },
    });
    expect(result.success).toBe(true);
  });

  it("accepts parameterized named assertions with nested templates", () => {
    const result = NamedAssertionsSchema.safeParse({
      tool_called_n_times: {
        tools: {
          filter: { having: { name: { equals: "${tool_name}" } } },
          count: { equals: "${n}" },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts script assertions in definitions", () => {
    const result = NamedAssertionsSchema.safeParse({
      db_exists: {
        script: { run: "scripts/check.sh", env: { TABLE: "${table}" } },
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("validateNamedAssertions", () => {
  it("passes for valid names", () => {
    expect(() =>
      validateNamedAssertions({ fast_response: {}, calls_agent: {} })
    ).not.toThrow();
  });

  it("throws when shadowing a built-in operator", () => {
    expect(() =>
      validateNamedAssertions({ equals: { text: { equals: "x" } } })
    ).toThrow("shadows built-in operator");
  });

  it("throws when shadowing a selector", () => {
    expect(() =>
      validateNamedAssertions({ text: { matches: "x" } })
    ).toThrow("shadows built-in selector");
  });
});

describe("resolveAssertBlock", () => {
  it("passes through built-in keys unchanged", () => {
    const block = {
      text: { matches: "hello" },
      tool_names: { some: { equals: "search" } },
    };
    const result = resolveAssertBlock(block, {});
    expect(result).toEqual(block);
  });

  it("expands a simple named assertion", () => {
    const named = {
      fast_response: { duration_ms: { max: 15000 } },
    };
    const block = { fast_response: {} };
    const result = resolveAssertBlock(block, named);
    expect(result).toEqual({ duration_ms: { max: 15000 } });
  });

  it("expands multiple named assertions", () => {
    const named = {
      fast_response: { duration_ms: { max: 15000 } },
      calls_agent: { tool_names: { some: { equals: "agent" } } },
    };
    const block = {
      fast_response: {},
      calls_agent: {},
      text: { matches: "hello" },
    };
    const result = resolveAssertBlock(block, named);
    expect(result).toEqual({
      duration_ms: { max: 15000 },
      tool_names: { some: { equals: "agent" } },
      text: { matches: "hello" },
    });
  });

  it("substitutes parameters", () => {
    const named = {
      completes_within: { duration_ms: { max: "${ms}" } },
    };
    const block = { completes_within: { ms: 10000 } };
    const result = resolveAssertBlock(block, named);
    expect(result).toEqual({ duration_ms: { max: 10000 } });
  });

  it("substitutes parameters in nested structures", () => {
    const named = {
      tool_called_n_times: {
        tools: {
          filter: { having: { name: { equals: "${tool_name}" } } },
          count: { equals: "${n}" },
        },
      },
    };
    const block = { tool_called_n_times: { tool_name: "search", n: 2 } };
    const result = resolveAssertBlock(block, named);
    expect(result).toEqual({
      tools: {
        filter: { having: { name: { equals: "search" } } },
        count: { equals: 2 },
      },
    });
  });

  it("throws on unresolved parameter", () => {
    const named = {
      needs_param: { duration_ms: { max: "${ms}" } },
    };
    expect(() =>
      resolveAssertBlock({ needs_param: {} }, named)
    ).toThrow("Unresolved parameter: ${ms}");
  });

  it("resolves named assertions inside or branches", () => {
    const named = {
      fast_response: { duration_ms: { max: 15000 } },
    };
    const block = {
      or: [{ fast_response: {} }, { text: { matches: "slow" } }],
    };
    const result = resolveAssertBlock(block, named);
    expect(result).toEqual({
      or: [{ duration_ms: { max: 15000 } }, { text: { matches: "slow" } }],
    });
  });

  it("resolves named assertions inside and branches", () => {
    const named = {
      fast_response: { duration_ms: { max: 15000 } },
    };
    const block = {
      and: [{ fast_response: {} }, { text: { matches: "ok" } }],
    };
    const result = resolveAssertBlock(block, named);
    expect(result).toEqual({
      and: [{ duration_ms: { max: 15000 } }, { text: { matches: "ok" } }],
    });
  });

  it("resolves named assertions inside not", () => {
    const named = {
      calls_agent: { tool_names: { some: { equals: "agent" } } },
    };
    const block = { not: { calls_agent: {} } };
    const result = resolveAssertBlock(block, named);
    expect(result).toEqual({
      not: { tool_names: { some: { equals: "agent" } } },
    });
  });

  it("passes through unknown keys (evaluator will error)", () => {
    const block = { unknown_thing: { foo: "bar" } };
    const result = resolveAssertBlock(block, {});
    expect(result).toEqual({ unknown_thing: { foo: "bar" } });
  });
});

describe("resolveAssertionNode", () => {
  it("passes through built-in operators unchanged", () => {
    const node = { equals: "hello" };
    const result = resolveAssertionNode(node, {});
    expect(result).toEqual(node);
  });

  it("expands named assertion inside a node", () => {
    const named = {
      is_valid_score: { min: 0, max: 100 },
    };
    const node = { is_valid_score: {} };
    const result = resolveAssertionNode(node, named);
    expect(result).toEqual({ min: 0, max: 100 });
  });

  it("expands named assertion with params inside having", () => {
    const named = {
      db_record_exists: {
        script: {
          run: "scripts/verify.sh",
          env: { TABLE: "${table}" },
        },
      },
    };
    const node = {
      having: {
        "result.json.id": { db_record_exists: { table: "projects" } },
      },
    };
    const result = resolveAssertionNode(node, named);
    expect(result).toEqual({
      having: {
        "result.json.id": {
          script: {
            run: "scripts/verify.sh",
            env: { TABLE: "projects" },
          },
        },
      },
    });
  });

  it("resolves inside some/every/none", () => {
    const named = {
      is_search: { having: { name: { equals: "search" } } },
    };
    const node = { some: { is_search: {} } };
    const result = resolveAssertionNode(node, named);
    expect(result).toEqual({
      some: { having: { name: { equals: "search" } } },
    });
  });

  it("resolves inside and/or arrays", () => {
    const named = {
      is_fast: { min: 0, max: 100 },
    };
    const node = { or: [{ is_fast: {} }, { equals: 999 }] };
    const result = resolveAssertionNode(node, named);
    expect(result).toEqual({
      or: [{ min: 0, max: 100 }, { equals: 999 }],
    });
  });
});
