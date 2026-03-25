import { describe, it, expect } from "vitest";
import {
  stringify,
  parsePattern,
  matchesPattern,
  getNestedValue,
  typeOf,
} from "./utils.js";

describe("stringify", () => {
  it("returns string as-is", () => {
    expect(stringify("hello")).toBe("hello");
  });

  it('returns "null" for null', () => {
    expect(stringify(null)).toBe("null");
  });

  it('returns "undefined" for undefined', () => {
    expect(stringify(undefined)).toBe("undefined");
  });

  it("JSON stringifies objects", () => {
    expect(stringify({ a: 1 })).toBe('{"a":1}');
  });

  it("JSON stringifies arrays", () => {
    expect(stringify([1, 2, 3])).toBe("[1,2,3]");
  });

  it("JSON stringifies numbers", () => {
    expect(stringify(42)).toBe("42");
  });

  it("JSON stringifies booleans", () => {
    expect(stringify(true)).toBe("true");
    expect(stringify(false)).toBe("false");
  });
});

describe("matchesPattern", () => {
  it("matches string values", () => {
    expect(matchesPattern("hello world", "hello")).toBe(true);
    expect(matchesPattern("hello world", "goodbye")).toBe(false);
  });

  it("matches stringified objects", () => {
    expect(matchesPattern({ name: "John" }, "John")).toBe(true);
    expect(matchesPattern({ name: "John" }, "Jane")).toBe(false);
  });

  it("supports regex patterns", () => {
    expect(matchesPattern("test@example.com", "\\w+@\\w+\\.com")).toBe(true);
  });

  it("supports /pattern/flags syntax", () => {
    expect(matchesPattern("Hello World", "/hello/i")).toBe(true);
    expect(matchesPattern("Hello World", "hello")).toBe(false);
  });
});

describe("parsePattern", () => {
  it("parses plain pattern without flags", () => {
    const regex = parsePattern("hello");
    expect(regex.source).toBe("hello");
    expect(regex.flags).toBe("");
  });

  it("parses /pattern/i for case insensitive", () => {
    const regex = parsePattern("/hello/i");
    expect(regex.source).toBe("hello");
    expect(regex.flags).toBe("i");
  });
});

describe("getNestedValue", () => {
  it("extracts simple path", () => {
    const result = getNestedValue({ name: "John" }, "name");
    expect(result).toEqual({ found: true, value: "John" });
  });

  it("extracts nested path", () => {
    const result = getNestedValue(
      { user: { address: { city: "Paris" } } },
      "user.address.city"
    );
    expect(result).toEqual({ found: true, value: "Paris" });
  });

  it("extracts array index", () => {
    const result = getNestedValue({ items: ["a", "b", "c"] }, "items[1]");
    expect(result).toEqual({ found: true, value: "b" });
  });

  it("returns not found for missing path", () => {
    const result = getNestedValue({ name: "John" }, "age");
    expect(result).toEqual({ found: false });
  });

  it("returns not found for missing nested path", () => {
    const result = getNestedValue({ user: {} }, "user.name");
    expect(result).toEqual({ found: false });
  });

  it("returns not found when traversing null", () => {
    const result = getNestedValue({ user: null }, "user.name");
    expect(result).toEqual({ found: false });
  });

  it("returns not found for out-of-bounds array index", () => {
    const result = getNestedValue({ items: ["a"] }, "items[5]");
    expect(result).toEqual({ found: false });
  });

  it("parses json as a dot-path segment (string → parsed)", () => {
    const obj = { result: '{"status":"ok","score":90}' };
    const statusResult = getNestedValue(obj, "result.json.status");
    expect(statusResult).toEqual({ found: true, value: "ok" });

    const scoreResult = getNestedValue(obj, "result.json.score");
    expect(scoreResult).toEqual({ found: true, value: 90 });
  });

  it("json segment passes through already-parsed values", () => {
    const obj = { result: { status: "ok" } };
    const result = getNestedValue(obj, "result.json.status");
    expect(result).toEqual({ found: true, value: "ok" });
  });

  it("json segment returns not found on invalid JSON", () => {
    const obj = { result: "not valid json" };
    const result = getNestedValue(obj, "result.json.status");
    expect(result).toEqual({ found: false });
  });

  it("json segment at end of path returns parsed value", () => {
    const obj = { result: '{"status":"ok"}' };
    const result = getNestedValue(obj, "result.json");
    expect(result).toEqual({ found: true, value: { status: "ok" } });
  });
});

describe("typeOf", () => {
  it("returns correct types", () => {
    expect(typeOf("hello")).toBe("string");
    expect(typeOf(42)).toBe("number");
    expect(typeOf(true)).toBe("boolean");
    expect(typeOf(null)).toBe("null");
    expect(typeOf([])).toBe("array");
    expect(typeOf({})).toBe("object");
    expect(typeOf(undefined)).toBe("undefined");
  });
});
