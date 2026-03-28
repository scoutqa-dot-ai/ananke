import { describe, it, expect } from "vitest";
import { evaluateStepAssertions } from "./engine.js";
import type { StepData } from "../types/data.js";

const makeStepData = (overrides: Partial<StepData> = {}): StepData => ({
  stepIndex: 0,
  toolCalls: [],
  assistantText: "",
  startTs: 1000,
  endTs: 2000,
  timings: { ttfEventMs: null, ttfToolMs: null, ttfTextMs: null },
  ...overrides,
});

describe("assertion script — unified contract", () => {
  it("receives ANANKE with value field", async () => {
    const stepData = makeStepData({ assistantText: "hello world" });
    // Script checks that ANANKE contains the asserted value
    const result = await evaluateStepAssertions(stepData, {
      text: {
        script: 'echo "$ANANKE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d[\'value\'] == \'hello world\'; print(\'{}\')"',
      },
    } as any);
    expect(result.passed).toBe(true);
  });

  it("receives ANANKE with steps array", async () => {
    const stepData = makeStepData({ assistantText: "hello" });
    const result = await evaluateStepAssertions(
      stepData,
      {
        text: {
          script: 'echo "$ANANKE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert \'steps\' in d; assert isinstance(d[\'steps\'], list); print(\'{}\')"',
        },
      } as any,
      { steps: [stepData], stepIndex: 0 }
    );
    expect(result.passed).toBe(true);
  });

  it("receives ANANKE with variables", async () => {
    const stepData = makeStepData({ assistantText: "hello" });
    const variables = { TOKEN: "abc123" };
    const result = await evaluateStepAssertions(
      stepData,
      {
        text: {
          script: 'echo "$ANANKE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d[\'variables\'][\'TOKEN\'] == \'abc123\'; print(\'{}\')"',
        },
      } as any,
      { variables, steps: [], stepIndex: 0 }
    );
    expect(result.passed).toBe(true);
  });

  it("merges variables from assertion script into variable map", async () => {
    const stepData = makeStepData({ assistantText: "hello" });
    const variables: Record<string, string> = { EXISTING: "old" };
    const result = await evaluateStepAssertions(
      stepData,
      {
        script: `echo '{"variables": {"NEW_VAR": "new_val"}}'`,
      } as any,
      { variables, steps: [], stepIndex: 0 }
    );
    expect(result.passed).toBe(true);
    // Variable should be merged into the shared map
    expect(variables.NEW_VAR).toBe("new_val");
    expect(variables.EXISTING).toBe("old");
  });

  it("ignores unknown fields like action in stdout", async () => {
    const stepData = makeStepData({ assistantText: "hello" });
    const result = await evaluateStepAssertions(stepData, {
      script: `echo '{"action": "skip_test", "reason": "whatever"}'`,
    } as any);
    expect(result.passed).toBe(true);
  });

  it("fails on non-JSON stdout", async () => {
    const stepData = makeStepData({ assistantText: "hello" });
    const result = await evaluateStepAssertions(stepData, {
      text: { script: "echo 'not json'" },
    } as any);
    expect(result.passed).toBe(false);
    expect(result.failures[0].actual).toContain("not valid JSON");
  });

  it("fails with stderr message on non-zero exit", async () => {
    const stepData = makeStepData({ assistantText: "hello" });
    const result = await evaluateStepAssertions(stepData, {
      script: "echo 'something broke' >&2 && exit 1",
    } as any);
    expect(result.passed).toBe(false);
    expect(result.failures[0].actual).toContain("something broke");
  });
});
