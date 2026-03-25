import { describe, it, expect } from "vitest";
import { interpolate, interpolateObject } from "./interpolate.js";

describe("interpolate", () => {
  it("replaces ${VAR.NAME} with variable value", () => {
    const result = interpolate("Hello ${VAR.NAME}!", { NAME: "World" });
    expect(result).toBe("Hello World!");
  });

  it("replaces multiple variables", () => {
    const result = interpolate("${VAR.GREETING} ${VAR.NAME}!", { GREETING: "Hi", NAME: "User" });
    expect(result).toBe("Hi User!");
  });

  it("throws on unset variable", () => {
    expect(() => interpolate("Hello ${VAR.UNKNOWN}!", {})).toThrow(
      'Variable "UNKNOWN" is not defined'
    );
  });

  it("throws on unset environment variable", () => {
    delete process.env.DEFINITELY_NOT_SET;
    expect(() => interpolate("${ENV.DEFINITELY_NOT_SET}", {})).toThrow(
      'Environment variable "DEFINITELY_NOT_SET" is not set'
    );
  });

  it("replaces ${ENV.VAR} with environment variable", () => {
    process.env.TEST_VAR = "test-value";
    const result = interpolate("Value: ${ENV.TEST_VAR}", {});
    expect(result).toBe("Value: test-value");
    delete process.env.TEST_VAR;
  });
});

describe("interpolateObject", () => {
  it("interpolates string values in object", () => {
    const result = interpolateObject(
      { greeting: "Hello ${VAR.NAME}", count: 42 },
      { NAME: "World" }
    );
    expect(result).toEqual({ greeting: "Hello World", count: 42 });
  });

  it("interpolates nested objects", () => {
    const result = interpolateObject(
      { outer: { inner: "${VAR.X}" } },
      { X: "value" }
    );
    expect(result).toEqual({ outer: { inner: "value" } });
  });

  it("preserves arrays and interpolates string elements", () => {
    const result = interpolateObject(
      { items: ["${VAR.A}", "${VAR.B}", "literal"] },
      { A: "first", B: "second" }
    );
    expect(result).toEqual({ items: ["first", "second", "literal"] });
    expect(Array.isArray(result.items)).toBe(true);
  });

  it("handles arrays of objects", () => {
    const result = interpolateObject(
      { list: [{ name: "${VAR.NAME}" }, { value: 123 }] },
      { NAME: "test" }
    );
    expect(result).toEqual({ list: [{ name: "test" }, { value: 123 }] });
    expect(Array.isArray(result.list)).toBe(true);
  });

  it("handles nested arrays", () => {
    const result = interpolateObject(
      { matrix: [["${VAR.A}", "${VAR.B}"], ["${VAR.C}"]] },
      { A: "1", B: "2", C: "3" }
    );
    expect(result).toEqual({ matrix: [["1", "2"], ["3"]] });
    expect(Array.isArray(result.matrix)).toBe(true);
    expect(Array.isArray(result.matrix[0])).toBe(true);
  });

  it("preserves non-string primitives in arrays", () => {
    const result = interpolateObject(
      { values: [1, true, null, "${VAR.X}"] },
      { X: "str" }
    );
    expect(result).toEqual({ values: [1, true, null, "str"] });
  });
});
