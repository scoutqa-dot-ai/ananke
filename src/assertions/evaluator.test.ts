import { describe, it, expect } from "vitest";
import { evaluate } from "./evaluator.js";

const ctx = { path: [] };

function failures(value: unknown, node: Record<string, unknown>) {
  return evaluate(value, node, ctx).filter((r) => !r.passed);
}

describe("evaluate", () => {
  // -----------------------------------------------------------------------
  // String assertions
  // -----------------------------------------------------------------------
  describe("string assertions", () => {
    it("equals passes on exact match", () => {
      expect(failures("hello", { equals: "hello" })).toHaveLength(0);
    });

    it("equals fails on mismatch", () => {
      expect(failures("hello", { equals: "world" })).toHaveLength(1);
    });

    it("contains passes on substring", () => {
      expect(failures("hello world", { contains: "world" })).toHaveLength(0);
    });

    it("contains fails on missing substring", () => {
      expect(failures("hello", { contains: "world" })).toHaveLength(1);
    });

    it("contains type mismatch on non-string", () => {
      const result = failures(42, { contains: "4" });
      expect(result).toHaveLength(1);
      expect(result[0].assertion).toContain("expects string");
    });

    it("starts_with passes", () => {
      expect(failures("hello world", { starts_with: "hello" })).toHaveLength(0);
    });

    it("starts_with fails", () => {
      expect(failures("hello world", { starts_with: "world" })).toHaveLength(1);
    });

    it("ends_with passes", () => {
      expect(failures("hello world", { ends_with: "world" })).toHaveLength(0);
    });

    it("ends_with fails", () => {
      expect(failures("hello world", { ends_with: "hello" })).toHaveLength(1);
    });

    it("must_match single pattern passes", () => {
      expect(failures("abc123", { must_match: "\\d+" })).toHaveLength(0);
    });

    it("must_match single pattern fails", () => {
      expect(failures("abc", { must_match: "\\d+" })).toHaveLength(1);
    });

    it("must_match array all pass", () => {
      expect(
        failures("hello world 42", { must_match: ["hello", "\\d+"] })
      ).toHaveLength(0);
    });

    it("must_match array partial fail", () => {
      expect(
        failures("hello world", { must_match: ["hello", "\\d+"] })
      ).toHaveLength(1);
    });

    it("must_not_match passes when no match", () => {
      expect(failures("hello", { must_not_match: "\\d+" })).toHaveLength(0);
    });

    it("must_not_match fails when matches", () => {
      expect(failures("hello42", { must_not_match: "\\d+" })).toHaveLength(1);
    });

    it("must_match supports /pattern/flags syntax", () => {
      expect(failures("Hello", { must_match: "/hello/i" })).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Number assertions
  // -----------------------------------------------------------------------
  describe("number assertions", () => {
    it("exact passes", () => {
      expect(failures(42, { exact: 42 })).toHaveLength(0);
    });

    it("exact fails", () => {
      expect(failures(42, { exact: 43 })).toHaveLength(1);
    });

    it("min passes", () => {
      expect(failures(10, { min: 5 })).toHaveLength(0);
    });

    it("min fails", () => {
      expect(failures(3, { min: 5 })).toHaveLength(1);
    });

    it("min passes at boundary", () => {
      expect(failures(5, { min: 5 })).toHaveLength(0);
    });

    it("max passes", () => {
      expect(failures(5, { max: 10 })).toHaveLength(0);
    });

    it("max fails", () => {
      expect(failures(15, { max: 10 })).toHaveLength(1);
    });

    it("max passes at boundary", () => {
      expect(failures(10, { max: 10 })).toHaveLength(0);
    });

    it("min and max combined (range)", () => {
      expect(failures(5, { min: 1, max: 10 })).toHaveLength(0);
      expect(failures(0, { min: 1, max: 10 })).toHaveLength(1);
      expect(failures(11, { min: 1, max: 10 })).toHaveLength(1);
    });

    it("type mismatch on non-number", () => {
      const result = failures("42", { min: 0 });
      expect(result).toHaveLength(1);
      expect(result[0].assertion).toContain("expects number");
    });
  });

  // -----------------------------------------------------------------------
  // Array assertions
  // -----------------------------------------------------------------------
  describe("array assertions", () => {
    it("count exact passes", () => {
      expect(failures([1, 2, 3], { count: { exact: 3 } })).toHaveLength(0);
    });

    it("count exact fails", () => {
      expect(failures([1, 2], { count: { exact: 3 } })).toHaveLength(1);
    });

    it("count min/max", () => {
      expect(failures([1, 2, 3], { count: { min: 2, max: 5 } })).toHaveLength(
        0
      );
    });

    it("every passes when all match", () => {
      expect(
        failures(["a", "b", "c"], { every: { must_match: "^[a-c]$" } })
      ).toHaveLength(0);
    });

    it("every fails when one doesn't match", () => {
      const result = failures(["a", "b", "z"], {
        every: { must_match: "^[a-c]$" },
      });
      expect(result.length).toBeGreaterThan(0);
    });

    it("every on empty array passes (vacuous truth)", () => {
      expect(failures([], { every: { equals: "x" } })).toHaveLength(0);
    });

    it("some passes when at least one matches", () => {
      expect(
        failures(["a", "b", "c"], { some: { equals: "b" } })
      ).toHaveLength(0);
    });

    it("some fails when none match", () => {
      expect(
        failures(["a", "b", "c"], { some: { equals: "z" } })
      ).toHaveLength(1);
    });

    it("some fails on empty array", () => {
      expect(failures([], { some: { equals: "x" } })).toHaveLength(1);
    });

    it("none passes when no elements match", () => {
      expect(
        failures(["a", "b", "c"], { none: { equals: "z" } })
      ).toHaveLength(0);
    });

    it("none fails when an element matches", () => {
      expect(
        failures(["a", "b", "c"], { none: { equals: "b" } })
      ).toHaveLength(1);
    });

    it("ordered passes in order", () => {
      expect(
        failures(["a", "b", "c", "d"], {
          ordered: [{ equals: "a" }, { equals: "c" }],
        })
      ).toHaveLength(0);
    });

    it("ordered fails when out of order", () => {
      expect(
        failures(["c", "a", "b"], {
          ordered: [{ equals: "a" }, { equals: "c" }],
        })
      ).toHaveLength(1);
    });

    it("ordered fails when element not found", () => {
      expect(
        failures(["a", "b"], {
          ordered: [{ equals: "a" }, { equals: "z" }],
        })
      ).toHaveLength(1);
    });

    it("filter + count", () => {
      const tools = [
        { name: "search", args: {} },
        { name: "lookup", args: {} },
        { name: "search", args: {} },
      ];
      expect(
        failures(tools, {
          filter: { match: { name: { equals: "search" } } },
          count: { exact: 2 },
        })
      ).toHaveLength(0);
    });

    it("filter + every on filtered results", () => {
      const items = [
        { type: "a", value: 1 },
        { type: "b", value: 2 },
        { type: "a", value: 3 },
      ];
      expect(
        failures(items, {
          filter: { match: { type: { equals: "a" } } },
          every: { match: { value: { min: 1 } } },
        })
      ).toHaveLength(0);
    });

    it("type mismatch for array ops on non-array", () => {
      expect(failures("hello", { count: { exact: 5 } })).toHaveLength(1);
      expect(failures("hello", { every: { equals: "h" } })).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Object assertions
  // -----------------------------------------------------------------------
  describe("object assertions", () => {
    it("has_key passes", () => {
      expect(failures({ name: "John" }, { has_key: "name" })).toHaveLength(0);
    });

    it("has_key fails", () => {
      expect(failures({ name: "John" }, { has_key: "age" })).toHaveLength(1);
    });

    it("not_has_key passes", () => {
      expect(failures({ name: "John" }, { not_has_key: "age" })).toHaveLength(
        0
      );
    });

    it("not_has_key fails", () => {
      expect(
        failures({ name: "John" }, { not_has_key: "name" })
      ).toHaveLength(1);
    });

    it("at extracts and asserts", () => {
      const obj = { user: { name: "John" } };
      expect(
        failures(obj, { at: { path: "user.name", assert: { equals: "John" } } })
      ).toHaveLength(0);
    });

    it("at fails when path not found", () => {
      expect(
        failures(
          { user: {} },
          { at: { path: "user.name", assert: { equals: "John" } } }
        )
      ).toHaveLength(1);
    });

    it("at supports array indexing", () => {
      const obj = { items: ["first", "second"] };
      expect(
        failures(obj, {
          at: { path: "items[0]", assert: { equals: "first" } },
        })
      ).toHaveLength(0);
    });

    it("match asserts on multiple fields", () => {
      const obj = { name: "search", args: { query: "weather" } };
      expect(
        failures(obj, {
          match: {
            name: { equals: "search" },
            "args.query": { contains: "weather" },
          },
        })
      ).toHaveLength(0);
    });

    it("match fails when field not found", () => {
      const obj = { name: "search" };
      expect(
        failures(obj, {
          match: { "args.query": { equals: "weather" } },
        })
      ).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Transforms
  // -----------------------------------------------------------------------
  describe("json transform", () => {
    it("parses JSON and asserts on result", () => {
      expect(
        failures('{"status":"ok"}', {
          json: { match: { status: { equals: "ok" } } },
        })
      ).toHaveLength(0);
    });

    it("fails on invalid JSON", () => {
      expect(
        failures("not json", { json: { match: { status: { equals: "ok" } } } })
      ).toHaveLength(1);
    });

    it("parses JSON array", () => {
      expect(
        failures("[1,2,3]", { json: { count: { exact: 3 } } })
      ).toHaveLength(0);
    });

    it("parses JSON number", () => {
      expect(failures("42", { json: { min: 40, max: 50 } })).toHaveLength(0);
    });

    it("passes through already-parsed objects", () => {
      const parsed = { status: "ok", count: 3 };
      expect(
        failures(parsed, {
          json: { match: { status: { equals: "ok" }, count: { exact: 3 } } },
        })
      ).toHaveLength(0);
    });

    it("passes through already-parsed arrays", () => {
      expect(
        failures([1, 2, 3], { json: { count: { exact: 3 } } })
      ).toHaveLength(0);
    });

    it("passes through already-parsed numbers", () => {
      expect(failures(42, { json: { min: 40 } })).toHaveLength(0);
    });

    it("fails on null value", () => {
      expect(
        failures(null, { json: { equals: "x" } })
      ).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Meta
  // -----------------------------------------------------------------------
  describe("meta assertions", () => {
    it("and passes when all pass", () => {
      expect(
        failures("hello world", {
          and: [{ contains: "hello" }, { contains: "world" }],
        })
      ).toHaveLength(0);
    });

    it("and reports all failures", () => {
      const result = failures("hello", {
        and: [{ contains: "world" }, { contains: "planet" }],
      });
      expect(result).toHaveLength(2);
    });

    it("or passes when one passes", () => {
      expect(
        failures("hello", {
          or: [{ equals: "hello" }, { equals: "world" }],
        })
      ).toHaveLength(0);
    });

    it("or fails when all fail", () => {
      const result = failures("hello", {
        or: [{ equals: "world" }, { equals: "planet" }],
      });
      expect(result).toHaveLength(1);
      expect(result[0].assertion).toBe("or");
    });

    it("not inverts failing assertion to pass", () => {
      expect(failures("hello", { not: { equals: "world" } })).toHaveLength(0);
    });

    it("not inverts passing assertion to fail", () => {
      expect(failures("hello", { not: { equals: "hello" } })).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // equals for non-string types (boolean, null, number)
  // -----------------------------------------------------------------------
  describe("equals for various types", () => {
    it("number equals", () => {
      expect(failures(42, { equals: 42 })).toHaveLength(0);
      expect(failures(42, { equals: 43 })).toHaveLength(1);
    });

    it("boolean equals", () => {
      expect(failures(true, { equals: true })).toHaveLength(0);
      expect(failures(true, { equals: false })).toHaveLength(1);
    });

    it("null equals", () => {
      expect(failures(null, { equals: null })).toHaveLength(0);
      expect(failures(null, { equals: "null" })).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Implicit AND (multiple sibling keys)
  // -----------------------------------------------------------------------
  describe("implicit AND", () => {
    it("multiple keys at same level are ANDed", () => {
      expect(
        failures("hello world", { contains: "hello", must_match: "world" })
      ).toHaveLength(0);
    });

    it("reports all sibling key failures", () => {
      const result = failures("abc", {
        contains: "xyz",
        must_match: "\\d+",
      });
      expect(result).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Complex: doc examples
  // -----------------------------------------------------------------------
  describe("doc examples", () => {
    it("S1: pure conversation, no tools", () => {
      // text + tools count 0
      const text = "Hello, I'm Kai from TestOps";
      const tools: unknown[] = [];

      const textFailures = failures(text, {
        must_match: ["Kai", "TestOps|TrueTest"],
      });
      expect(textFailures).toHaveLength(0);

      const toolFailures = failures(tools, { count: { exact: 0 } });
      expect(toolFailures).toHaveLength(0);
    });

    it("tool_names some with equals", () => {
      const names = ["intent_agent", "get_project_status"];
      expect(
        failures(names, { some: { equals: "get_project_status" } })
      ).toHaveLength(0);
    });

    it("tool_names ordered", () => {
      const names = ["intent_agent", "find_iterations", "generate_urls"];
      expect(
        failures(names, {
          ordered: [
            { equals: "intent_agent" },
            { equals: "find_iterations" },
            { equals: "generate_urls" },
          ],
        })
      ).toHaveLength(0);
    });

    it("tool_names none with must_match", () => {
      const names = ["intent_agent", "find_iterations"];
      expect(
        failures(names, { none: { must_match: "stability_.*" } })
      ).toHaveLength(0);
    });

    it("filter + count for specific tool with args", () => {
      const tools = [
        { name: "search", args: { query: "weather today" }, result: "ok" },
        { name: "search", args: { query: "weather tomorrow" }, result: "ok" },
        { name: "lookup", args: { id: "1" }, result: "ok" },
      ];
      expect(
        failures(tools, {
          filter: {
            match: {
              name: { equals: "search" },
              "args.query": { must_match: "weather" },
            },
          },
          count: { exact: 2 },
        })
      ).toHaveLength(0);
    });

    it("none with match for forbid pattern", () => {
      const tools = [
        { name: "safe_query", args: { table: "products" }, result: '{"data":"ok"}' },
      ];
      expect(
        failures(tools, {
          none: {
            match: {
              name: { equals: "database_query" },
              "args.table": { equals: "users" },
            },
          },
        })
      ).toHaveLength(0);
    });

    it("some with match + json on result", () => {
      const tools = [
        {
          name: "get_report",
          args: {},
          result: '{"status":"ok","items":["a","b"],"score":90}',
        },
      ];
      expect(
        failures(tools, {
          some: {
            match: {
              name: { equals: "get_report" },
              result: {
                json: {
                  match: {
                    status: { equals: "ok" },
                    items: { count: { min: 1 } },
                    score: { min: 80, max: 100 },
                  },
                },
              },
            },
          },
        })
      ).toHaveLength(0);
    });
  });
});
