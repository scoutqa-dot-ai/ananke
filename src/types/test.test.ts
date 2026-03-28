import { describe, it, expect } from "vitest";
import {
  TestFileSchema,
  isMessageStep,
  isResumeStep,
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
          expect: { text: { matches: "hello" } },
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
        { message: "Hello" },
        { script: "scripts/gen.sh" },
        { message: "Follow up ${VAR.MESSAGE}" },
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

  it("accepts resume step with thread ID", () => {
    const input = {
      version: "1.0",
      name: "resume test",
      steps: [
        { type: "resume", resume: "th_123" },
      ],
    };
    const result = TestFileSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects resume step without resume field", () => {
    const input = {
      version: "1.0",
      name: "bad resume test",
      steps: [
        { type: "resume" },
      ],
    };
    const result = TestFileSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("accepts resume step with assert", () => {
    const input = {
      version: "1.0",
      name: "resume with assert",
      steps: [
        {
          type: "resume",
          resume: "th_123",
          expect: { text: { matches: "restored" } },
        },
      ],
    };
    const result = TestFileSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});

describe("type guards", () => {
  it("isMessageStep identifies message steps", () => {
    expect(isMessageStep({ message: "hello" } as any)).toBe(true);
    expect(isMessageStep({ type: "script", script: "x" } as any)).toBe(false);
  });

  it("isResumeStep identifies resume steps", () => {
    expect(isResumeStep({ type: "resume", resume: "th_123" } as any)).toBe(true);
    expect(isResumeStep({ message: "hello" } as any)).toBe(false);
  });

  it("isScriptStep identifies script steps", () => {
    expect(isScriptStep({ script: "x" } as any)).toBe(true);
    expect(isScriptStep({ type: "script", script: "x" } as any)).toBe(true);
    expect(isScriptStep({ message: "hello" } as any)).toBe(false);
    expect(isScriptStep({ type: "resume", resume: "th_123" } as any)).toBe(false);
  });
});
