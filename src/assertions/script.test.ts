import { describe, it, expect } from "vitest";
import { evaluateTurnAssertions } from "./engine.js";
import type { TurnData } from "../types/data.js";

const makeTurnData = (overrides: Partial<TurnData> = {}): TurnData => ({
  turnIndex: 0,
  toolCalls: [],
  assistantText: "",
  startTs: 1000,
  endTs: 2000,
  timings: { ttfEventMs: null, ttfToolMs: null, ttfTextMs: null },
  ...overrides,
});

describe("assertion script — unified contract", () => {
  it("receives ANANKE with value field", async () => {
    const turnData = makeTurnData({ assistantText: "hello world" });
    // Script checks that ANANKE contains the asserted value
    const result = await evaluateTurnAssertions(turnData, {
      text: {
        script: 'echo "$ANANKE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d[\'value\'] == \'hello world\'; print(\'{}\')"',
      },
    } as any);
    expect(result.passed).toBe(true);
  });

  it("receives ANANKE with turns array", async () => {
    const turnData = makeTurnData({ assistantText: "hello" });
    const result = await evaluateTurnAssertions(
      turnData,
      {
        text: {
          script: 'echo "$ANANKE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert \'turns\' in d; assert isinstance(d[\'turns\'], list); print(\'{}\')"',
        },
      } as any,
      { turns: [turnData], turnIndex: 0 }
    );
    expect(result.passed).toBe(true);
  });

  it("receives ANANKE with variables", async () => {
    const turnData = makeTurnData({ assistantText: "hello" });
    const variables = { TOKEN: "abc123" };
    const result = await evaluateTurnAssertions(
      turnData,
      {
        text: {
          script: 'echo "$ANANKE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d[\'variables\'][\'TOKEN\'] == \'abc123\'; print(\'{}\')"',
        },
      } as any,
      { variables, turns: [], turnIndex: 0 }
    );
    expect(result.passed).toBe(true);
  });

  it("captures reason from script stdout", async () => {
    const turnData = makeTurnData({ assistantText: "hello" });
    const result = await evaluateTurnAssertions(turnData, {
      script: `echo '{"reason": "user verified"}'`,
    } as any);
    expect(result.passed).toBe(true);
    const scriptResult = result.results.find((r) => r.assertion === "script");
    expect(scriptResult?.reason).toBe("user verified");
  });

  it("merges variables from assertion script into variable map", async () => {
    const turnData = makeTurnData({ assistantText: "hello" });
    const variables = { EXISTING: "old" };
    const result = await evaluateTurnAssertions(
      turnData,
      {
        script: `echo '{"variables": {"NEW_VAR": "new_val"}}'`,
      } as any,
      { variables, turns: [], turnIndex: 0 }
    );
    expect(result.passed).toBe(true);
    // Variable should be merged into the shared map
    expect(variables.NEW_VAR).toBe("new_val");
    expect(variables.EXISTING).toBe("old");
  });

  it("ignores unknown fields like action in stdout", async () => {
    const turnData = makeTurnData({ assistantText: "hello" });
    const result = await evaluateTurnAssertions(turnData, {
      script: `echo '{"action": "skip_test", "reason": "whatever"}'`,
    } as any);
    expect(result.passed).toBe(true);
  });

  it("fails on non-JSON stdout", async () => {
    const turnData = makeTurnData({ assistantText: "hello" });
    const result = await evaluateTurnAssertions(turnData, {
      text: { script: "echo 'not json'" },
    } as any);
    expect(result.passed).toBe(false);
    expect(result.failures[0].actual).toContain("not valid JSON");
  });

  it("fails with stderr message on non-zero exit", async () => {
    const turnData = makeTurnData({ assistantText: "hello" });
    const result = await evaluateTurnAssertions(turnData, {
      script: "echo 'something broke' >&2 && exit 1",
    } as any);
    expect(result.passed).toBe(false);
    expect(result.failures[0].actual).toContain("something broke");
  });
});
