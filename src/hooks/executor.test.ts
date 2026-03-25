import { describe, it, expect } from "vitest";
import { executeHook, executeHooks } from "./executor.js";

describe("executeHook", () => {
  it("parses new variables format", async () => {
    const result = await executeHook({
      cmd: ["echo", '{"variables": {"TOKEN": "abc"}}'],
    });
    expect(result.variables).toEqual({ TOKEN: "abc" });
  });

  it("returns empty variables for empty JSON object", async () => {
    const result = await executeHook({
      cmd: ["echo", "{}"],
    });
    expect(result.variables).toEqual({});
  });

  it("preserves argument boundaries with JSON", async () => {
    const result = await executeHook({
      cmd: ["echo", '{"variables": {"KEY": "value with spaces"}}'],
    });
    expect(result.variables).toEqual({ KEY: "value with spaces" });
  });

  it("passes ANANKE env var to hook", async () => {
    const result = await executeHook({
      cmd: ["bash", "-c", 'echo "$ANANKE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps({\'variables\':{\'GOT_ANANKE\': \'yes\' if d.get(\'value\') is None else \'no\'}}))"'],
    });
    expect(result.variables).toEqual({ GOT_ANANKE: "yes" });
  });

  it("passes current variables in ANANKE", async () => {
    const result = await executeHook(
      {
        cmd: ["bash", "-c", 'echo "$ANANKE" | python3 -c "import sys,json; d=json.load(sys.stdin); v=d.get(\'variables\',{}); print(json.dumps({\'variables\':{\'PREV\': v.get(\'EXISTING\',\'missing\')}}))"'],
      },
      { currentVars: { EXISTING: "hello" } }
    );
    expect(result.variables).toEqual({ PREV: "hello" });
  });

  it("interpolates hook env with current variables", async () => {
    const result = await executeHook(
      {
        cmd: ["bash", "-c", 'echo "{\\\"variables\\\": {\\\"GOT\\\": \\\"$MY_VAR\\\"}}"'],
        env: { MY_VAR: "${VAR.TOKEN}" },
      },
      { currentVars: { TOKEN: "secret123" } }
    );
    expect(result.variables).toEqual({ GOT: "secret123" });
  });

  it("returns skip_hook action", async () => {
    const result = await executeHook({
      cmd: ["echo", '{"action": "skip_hook"}'],
    });
    expect(result.action).toBe("skip_hook");
    expect(result.variables).toEqual({});
  });

  it("returns skip_test action", async () => {
    const result = await executeHook({
      cmd: ["echo", '{"action": "skip_test"}'],
    });
    expect(result.action).toBe("skip_test");
  });

  it("throws on non-zero exit code", async () => {
    await expect(
      executeHook({ cmd: ["bash", "-c", "exit 1"] })
    ).rejects.toThrow("Hook failed");
  });

  it("throws on non-JSON output", async () => {
    await expect(
      executeHook({ cmd: ["echo", "not json"] })
    ).rejects.toThrow("not valid JSON");
  });
});

describe("executeHooks", () => {
  it("accumulates variables across hooks", async () => {
    const result = await executeHooks([
      { cmd: ["echo", '{"variables": {"A": "1"}}'] },
      { cmd: ["echo", '{"variables": {"B": "2"}}'] },
    ]);
    expect(result.variables).toEqual({ A: "1", B: "2" });
    expect(result.skipped).toBe(false);
  });

  it("skip_hook skips one hook but continues", async () => {
    const result = await executeHooks([
      { cmd: ["echo", '{"variables": {"A": "1"}}'] },
      { cmd: ["echo", '{"action": "skip_hook"}'] },
      { cmd: ["echo", '{"variables": {"C": "3"}}'] },
    ]);
    expect(result.variables).toEqual({ A: "1", C: "3" });
    expect(result.skipped).toBe(false);
  });

  it("skip_test stops execution and returns skipped", async () => {
    const result = await executeHooks([
      { cmd: ["echo", '{"variables": {"A": "1"}}'] },
      { cmd: ["echo", '{"action": "skip_test"}'] },
      { cmd: ["echo", '{"variables": {"C": "3"}}'] }, // should not execute
    ]);
    expect(result.variables).toEqual({ A: "1" });
    expect(result.skipped).toBe(true);
  });
});
