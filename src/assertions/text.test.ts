import { describe, it, expect } from "vitest";
import { assertText } from "./text.js";

describe("assertText", () => {
  describe("must_match (string)", () => {
    it("passes when pattern matches", () => {
      const results = assertText("Hello, how can I help you?", {
        must_match: "help",
      });
      expect(results).toHaveLength(0);
    });

    it("fails when pattern does not match", () => {
      const results = assertText("Hello, goodbye!", {
        must_match: "help",
      });
      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(false);
    });
  });

  describe("must_not_match (string)", () => {
    it("passes when pattern does not match", () => {
      const results = assertText("Everything is fine", {
        must_not_match: "error",
      });
      expect(results).toHaveLength(0);
    });

    it("fails when pattern matches", () => {
      const results = assertText("An error occurred", {
        must_not_match: "error",
      });
      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(false);
    });
  });

  describe("must_match (array)", () => {
    it("passes when all patterns match", () => {
      const results = assertText("The quick brown fox jumps", {
        must_match: ["quick", "fox"],
      });
      expect(results).toHaveLength(0);
    });

    it("fails for each pattern that does not match", () => {
      const results = assertText("The quick brown fox jumps", {
        must_match: ["quick", "dog", "cat"],
      });
      expect(results).toHaveLength(2);
      expect(results.every((r) => !r.passed)).toBe(true);
    });
  });

  describe("must_not_match (array)", () => {
    it("passes when no patterns match", () => {
      const results = assertText("Everything is fine", {
        must_not_match: ["error", "failed", "exception"],
      });
      expect(results).toHaveLength(0);
    });

    it("fails for each pattern that matches", () => {
      const results = assertText("An error occurred and failed", {
        must_not_match: ["error", "failed", "exception"],
      });
      expect(results).toHaveLength(2);
      expect(results.every((r) => !r.passed)).toBe(true);
    });
  });

  it("supports regex patterns", () => {
    const results = assertText("The answer is 42", {
      must_match: "\\d+",
    });
    expect(results).toHaveLength(0);
  });

  it("truncates long text in output", () => {
    const longText = "x".repeat(200);
    const results = assertText(longText, {
      must_match: "not found",
    });
    expect(results).toHaveLength(1);
    expect(results[0].actual?.length).toBeLessThan(150);
    expect(results[0].actual).toContain("...");
  });
});
