import { describe, it, expect } from "vitest";
import { interpolate, interpolateObject } from "./interpolate.js";

describe("interpolate", () => {
  it("replaces ${VAR} with variable value", () => {
    const result = interpolate("Hello ${NAME}!", { NAME: "World" });
    expect(result).toBe("Hello World!");
  });

  it("replaces multiple variables", () => {
    const result = interpolate("${GREETING} ${NAME}!", { GREETING: "Hi", NAME: "User" });
    expect(result).toBe("Hi User!");
  });

  it("leaves unknown variables as empty string", () => {
    const result = interpolate("Hello ${UNKNOWN}!", {});
    expect(result).toBe("Hello !");
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
      { greeting: "Hello ${NAME}", count: 42 },
      { NAME: "World" }
    );
    expect(result).toEqual({ greeting: "Hello World", count: 42 });
  });

  it("interpolates nested objects", () => {
    const result = interpolateObject(
      { outer: { inner: "${VAR}" } },
      { VAR: "value" }
    );
    expect(result).toEqual({ outer: { inner: "value" } });
  });

  it("preserves arrays and interpolates string elements", () => {
    const result = interpolateObject(
      { items: ["${A}", "${B}", "literal"] },
      { A: "first", B: "second" }
    );
    expect(result).toEqual({ items: ["first", "second", "literal"] });
    expect(Array.isArray(result.items)).toBe(true);
  });

  it("handles arrays of objects", () => {
    const result = interpolateObject(
      { list: [{ name: "${NAME}" }, { value: 123 }] },
      { NAME: "test" }
    );
    expect(result).toEqual({ list: [{ name: "test" }, { value: 123 }] });
    expect(Array.isArray(result.list)).toBe(true);
  });

  it("handles nested arrays", () => {
    const result = interpolateObject(
      { matrix: [["${A}", "${B}"], ["${C}"]] },
      { A: "1", B: "2", C: "3" }
    );
    expect(result).toEqual({ matrix: [["1", "2"], ["3"]] });
    expect(Array.isArray(result.matrix)).toBe(true);
    expect(Array.isArray(result.matrix[0])).toBe(true);
  });

  it("preserves non-string primitives in arrays", () => {
    const result = interpolateObject(
      { values: [1, true, null, "${VAR}"] },
      { VAR: "str" }
    );
    expect(result).toEqual({ values: [1, true, null, "str"] });
  });
});
