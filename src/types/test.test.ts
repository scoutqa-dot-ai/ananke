import { describe, it, expect } from "vitest";
import {
  TestFileSchema,
  isUserStep,
  isConnectStep,
  isScriptStep,
} from "./test.js";

describe("TestFileSchema", () => {
  it("accepts script step with short form (no type)", () => {
    const input = {
      version: "1.0",
      name: "script test",
      steps: [
        { script: "scripts/gen.sh" },
      ],
    };
    const result = TestFileSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("accepts script step with explicit type", () => {
    const input = {
      version: "1.0",
      name: "script test",
      steps: [
        { type: "script", script: "scripts/gen.sh" },
      ],
    };
    const result = TestFileSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("accepts script step with long form", () => {
    const input = {
      version: "1.0",
      name: "script test",
      steps: [
        {
          script: {
            run: "scripts/gen.sh",
            timeout_ms: 5000,
            env: { KEY: "val" },
          },
        },
      ],
    };
    const result = TestFileSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects script step with assert (script steps don't take assertions)", () => {
    const input = {
      version: "1.0",
      name: "script test",
      steps: [
        {
          script: "scripts/gen.sh",
          assert: { text: { matches: "hello" } },
        },
      ],
    };
    const result = TestFileSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("accepts mixed step types", () => {
    const input = {
      version: "1.0",
      name: "mixed test",
      steps: [
        { script: "scripts/setup.sh" },
        { user: "Hello" },
        { script: "scripts/gen.sh" },
        { user: "Follow up ${VAR.MESSAGE}" },
      ],
    };
    const result = TestFileSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects script step without script field", () => {
    const input = {
      version: "1.0",
      name: "bad test",
      steps: [
        { type: "script" },
      ],
    };
    const result = TestFileSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe("type guards", () => {
  it("isUserStep identifies user steps", () => {
    expect(isUserStep({ user: "hello" } as any)).toBe(true);
    expect(isUserStep({ type: "script", script: "x" } as any)).toBe(false);
  });

  it("isConnectStep identifies connect steps", () => {
    expect(isConnectStep({ type: "agui:connect" } as any)).toBe(true);
    expect(isConnectStep({ user: "hello" } as any)).toBe(false);
  });

  it("isScriptStep identifies script steps", () => {
    expect(isScriptStep({ script: "x" } as any)).toBe(true);
    expect(isScriptStep({ type: "script", script: "x" } as any)).toBe(true);
    expect(isScriptStep({ user: "hello" } as any)).toBe(false);
    expect(isScriptStep({ type: "agui:connect" } as any)).toBe(false);
  });
});
