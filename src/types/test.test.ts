import { describe, it, expect } from "vitest";
import {
  TestFileSchema,
  isUserTurn,
  isConnectTurn,
  isScriptTurn,
} from "./test.js";

describe("TestFileSchema", () => {
  it("accepts script turn with short form", () => {
    const input = {
      version: "1.0",
      name: "script test",
      turns: [
        { type: "script", script: "scripts/gen.sh" },
      ],
    };
    const result = TestFileSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("accepts script turn with long form", () => {
    const input = {
      version: "1.0",
      name: "script test",
      turns: [
        {
          type: "script",
          script: {
            run: "scripts/gen.sh",
            timeout_ms: 5000,
            env: { KEY: "val" },
          },
          assert: { text: { matches: "hello" } },
        },
      ],
    };
    const result = TestFileSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("accepts mixed turn types", () => {
    const input = {
      version: "1.0",
      name: "mixed test",
      turns: [
        { user: "Hello" },
        { type: "script", script: "scripts/gen.sh" },
        { user: "Follow up" },
      ],
    };
    const result = TestFileSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects script turn without script field", () => {
    const input = {
      version: "1.0",
      name: "bad test",
      turns: [
        { type: "script" },
      ],
    };
    const result = TestFileSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe("type guards", () => {
  it("isUserTurn identifies user turns", () => {
    expect(isUserTurn({ user: "hello" } as any)).toBe(true);
    expect(isUserTurn({ type: "script", script: "x" } as any)).toBe(false);
  });

  it("isConnectTurn identifies connect turns", () => {
    expect(isConnectTurn({ type: "agui:connect" } as any)).toBe(true);
    expect(isConnectTurn({ user: "hello" } as any)).toBe(false);
  });

  it("isScriptTurn identifies script turns", () => {
    expect(isScriptTurn({ type: "script", script: "x" } as any)).toBe(true);
    expect(isScriptTurn({ user: "hello" } as any)).toBe(false);
    expect(isScriptTurn({ type: "agui:connect" } as any)).toBe(false);
  });
});
