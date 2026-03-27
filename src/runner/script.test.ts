import { describe, it, expect } from "vitest";
import {
  executeScript,
  normalizeScriptConfig,
  buildAnankeInput,
  type ScriptConfig,
  type AnankeInput,
} from "./script.js";

describe("normalizeScriptConfig", () => {
  it("converts string to config object", () => {
    const config = normalizeScriptConfig("echo hello");
    expect(config).toEqual({ run: "echo hello" });
  });

  it("passes through object config", () => {
    const input = { run: "echo hello", timeout_ms: 5000, env: { FOO: "bar" } };
    const config = normalizeScriptConfig(input);
    expect(config).toEqual(input);
  });
});

describe("buildAnankeInput", () => {
  it("returns defaults when no options provided", () => {
    const input = buildAnankeInput({});
    expect(input).toEqual({
      value: null,
      turns: [],
      variables: {},
      turnIndex: null,
    });
  });

  it("passes through provided values", () => {
    const input = buildAnankeInput({
      value: "test_value",
      turns: [{ turnIndex: 0, toolCalls: [], assistantText: "hi", startTs: 0, endTs: 1, timings: { ttfEventMs: null, ttfToolMs: null, ttfTextMs: null } }],
      variables: { A: "1" },
      turnIndex: 2,
    });
    expect(input.value).toBe("test_value");
    expect(input.turns).toHaveLength(1);
    expect(input.variables).toEqual({ A: "1" });
    expect(input.turnIndex).toBe(2);
  });
});

describe("executeScript", () => {
  describe("shell mode (run string)", () => {
    it("executes successfully and returns empty output", async () => {
      const config: ScriptConfig = { run: "true" };
      const ananke = buildAnankeInput({});
      const result = await executeScript(config, ananke);
      expect(result.exitCode).toBe(0);
      expect(result.output.variables).toEqual({});
    });

    it("captures non-zero exit code", async () => {
      const config: ScriptConfig = { run: "false" };
      const ananke = buildAnankeInput({});
      const result = await executeScript(config, ananke);
      expect(result.exitCode).not.toBe(0);
    });

    it("captures stderr on failure", async () => {
      const config: ScriptConfig = { run: "echo 'oops' >&2 && exit 1" };
      const ananke = buildAnankeInput({});
      const result = await executeScript(config, ananke);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("oops");
    });

    it("passes ANANKE env var", async () => {
      const config: ScriptConfig = { run: 'echo "$ANANKE" | grep -q "test_val" && echo "{}"' };
      const ananke = buildAnankeInput({ value: "test_val" });
      const result = await executeScript(config, ananke);
      expect(result.exitCode).toBe(0);
    });

    it("passes ANANKE via stdin", async () => {
      const config: ScriptConfig = { run: 'cat | grep -q "stdin_val" && echo "{}"' };
      const ananke = buildAnankeInput({ value: "stdin_val" });
      const result = await executeScript(config, ananke);
      expect(result.exitCode).toBe(0);
    });

    it("passes custom env vars", async () => {
      const config: ScriptConfig = {
        run: 'test "$MY_KEY" = "my_value" && echo "{}"',
        env: { MY_KEY: "my_value" },
      };
      const ananke = buildAnankeInput({});
      const result = await executeScript(config, ananke);
      expect(result.exitCode).toBe(0);
    });

    it("passes extra env vars", async () => {
      const config: ScriptConfig = { run: 'test "$EXTRA" = "val" && echo "{}"' };
      const ananke = buildAnankeInput({});
      const result = await executeScript(config, ananke, {
        extraEnv: { EXTRA: "val" },
      });
      expect(result.exitCode).toBe(0);
    });
  });

  describe("args mode (command + args)", () => {
    it("preserves argument boundaries", async () => {
      // This JSON string would break if shell-joined
      const config: ScriptConfig = {
        run: "echo",
        args: ['{"variables": {"KEY": "val"}}'],
      };
      const ananke = buildAnankeInput({});
      const result = await executeScript(config, ananke);
      expect(result.exitCode).toBe(0);
      expect(result.output.variables).toEqual({ KEY: "val" });
    });
  });

  describe("stdout JSON parsing", () => {
    it("parses variables from stdout", async () => {
      const config: ScriptConfig = {
        run: `echo '{"variables": {"TOKEN": "abc", "ID": "123"}}'`,
      };
      const ananke = buildAnankeInput({});
      const result = await executeScript(config, ananke);
      expect(result.exitCode).toBe(0);
      expect(result.output.variables).toEqual({ TOKEN: "abc", ID: "123" });
    });

    it("parses message from stdout", async () => {
      const config: ScriptConfig = {
        run: `echo '{"message": "Use option A"}'`,
      };
      const ananke = buildAnankeInput({});
      const result = await executeScript(config, ananke);
      expect(result.output.message).toBe("Use option A");
    });

    it("parses reason from stdout", async () => {
      const config: ScriptConfig = {
        run: `echo '{"reason": "User verified"}'`,
      };
      const ananke = buildAnankeInput({});
      const result = await executeScript(config, ananke);
      expect(result.output.reason).toBe("User verified");
    });

    it("converts variable values to strings", async () => {
      const config: ScriptConfig = {
        run: `echo '{"variables": {"NUM": 42, "BOOL": true}}'`,
      };
      const ananke = buildAnankeInput({});
      const result = await executeScript(config, ananke);
      expect(result.output.variables).toEqual({ NUM: "42", BOOL: "true" });
    });

    it("returns failure on non-JSON stdout with exit 0", async () => {
      const config: ScriptConfig = { run: "echo 'not json'" };
      const ananke = buildAnankeInput({});
      const result = await executeScript(config, ananke);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("not valid JSON");
    });

    it("returns failure on array stdout", async () => {
      const config: ScriptConfig = { run: `echo '[1,2,3]'` };
      const ananke = buildAnankeInput({});
      const result = await executeScript(config, ananke);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("must be a JSON object");
    });

    it("handles empty stdout as empty output", async () => {
      const config: ScriptConfig = { run: "true" };
      const ananke = buildAnankeInput({});
      const result = await executeScript(config, ananke);
      expect(result.output.variables).toEqual({});
      expect(result.output.message).toBeUndefined();
    });

    it("ignores unknown fields in stdout JSON", async () => {
      const config: ScriptConfig = {
        run: `echo '{"variables": {"A": "1"}, "action": "skip_test", "extra": true}'`,
      };
      const ananke = buildAnankeInput({});
      const result = await executeScript(config, ananke);
      expect(result.exitCode).toBe(0);
      expect(result.output.variables).toEqual({ A: "1" });
    });
  });

  describe("timeout", () => {
    it("returns non-zero exit with clear message on timeout", async () => {
      const config: ScriptConfig = { run: "sleep 10", timeout_ms: 100 };
      const ananke = buildAnankeInput({});
      const result = await executeScript(config, ananke);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("timed out after 100ms");
      expect(result.stderr).toContain("sleep 10");
    }, 5000);
  });

  describe("combined output", () => {
    it("parses message + variables together", async () => {
      const config: ScriptConfig = {
        run: `echo '{"message": "Hello", "variables": {"ID": "42"}, "reason": "all good"}'`,
      };
      const ananke = buildAnankeInput({});
      const result = await executeScript(config, ananke);
      expect(result.output.message).toBe("Hello");
      expect(result.output.variables).toEqual({ ID: "42" });
      expect(result.output.reason).toBe("all good");
    });
  });
});
