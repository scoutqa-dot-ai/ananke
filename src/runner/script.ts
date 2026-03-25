import { execa } from "execa";
import type { Variables } from "../config/interpolate.js";
import type { TurnData } from "../types/data.js";
import type { Logger } from "../logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScriptConfig {
  run: string;
  /** Arguments for command execution (preserves argv boundaries). Mutually exclusive with shell mode. */
  args?: string[];
  timeout_ms?: number;
  env?: Record<string, string>;
}

/** The JSON object every script receives via ANANKE env var and stdin */
export interface AnankeInput {
  value: unknown;
  turns: TurnData[];
  variables: Variables;
  turnIndex: number | null;
}

/** Valid actions a script can return in stdout JSON */
export type ScriptAction =
  | "skip_hook"
  | "skip_turn"
  | "skip_test"
  | "skip_assertion";

/** Where the script is being executed from */
export type ScriptLocation = "hook" | "turn" | "assertion";

/** Parsed stdout from any script */
export interface ScriptOutput {
  variables: Variables;
  message?: string;
  reason?: string;
  action?: ScriptAction;
}

/** Full result of executing a script */
export interface ScriptResult {
  output: ScriptOutput;
  exitCode: number;
  stderr: string;
}

const VALID_ACTIONS_BY_LOCATION: Record<ScriptLocation, Set<ScriptAction>> = {
  hook: new Set(["skip_hook", "skip_test"]),
  turn: new Set(["skip_turn", "skip_test"]),
  assertion: new Set(["skip_assertion", "skip_test"]),
};

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_HOOK_TIMEOUT_MS = 30_000;

/**
 * Merge script output variables into a target variable map with override logging.
 */
export function mergeVariables(
  target: Variables,
  source: Variables,
  location: string,
  logger?: Logger,
): void {
  for (const [key, val] of Object.entries(source)) {
    const old = target[key];
    if (old !== undefined && old !== val) {
      logger?.debug(`Variable "${key}" overridden by ${location} (was: "${old}", now: "${val}")`);
    }
    target[key] = val;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalize string or object form into a ScriptConfig.
 */
export function normalizeScriptConfig(operand: unknown): ScriptConfig {
  if (typeof operand === "string") {
    return { run: operand };
  }
  return operand as ScriptConfig;
}

/**
 * Build the ANANKE input object for a given location.
 */
export function buildAnankeInput(opts: {
  value?: unknown;
  turns?: TurnData[];
  variables?: Variables;
  turnIndex?: number | null;
}): AnankeInput {
  return {
    value: opts.value ?? null,
    turns: opts.turns ?? [],
    variables: opts.variables ?? {},
    turnIndex: opts.turnIndex ?? null,
  };
}

/**
 * Execute a script with the unified contract.
 *
 * - Sets ANANKE env var and passes it to stdin
 * - Parses stdout as JSON
 * - Validates action field against location
 * - Returns parsed output, exit code, and stderr
 */
export async function executeScript(
  config: ScriptConfig,
  ananke: AnankeInput,
  location: ScriptLocation,
  opts?: { logger?: Logger; extraEnv?: Record<string, string> }
): Promise<ScriptResult> {
  const { logger } = opts ?? {};
  const timeout = config.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const anankeJson = JSON.stringify(ananke);

  logger?.debug(`[Script] Running: ${config.run} (location=${location}, timeout=${timeout}ms)`);

  // Build env: process.env + ANANKE + config.env + extraEnv
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ANANKE: anankeJson,
    ...config.env,
    ...opts?.extraEnv,
  };

  try {
    // Two modes:
    // - args mode: command + args array (preserves argv boundaries, no shell)
    // - shell mode: single run string (supports pipes, redirects)
    const result = config.args
      ? await execa(config.run, config.args, {
          input: anankeJson,
          timeout,
          env,
          reject: false,
        })
      : await execa({
          shell: true,
          input: anankeJson,
          timeout,
          env,
          reject: false,
        })`${config.run}`;

    const exitCode = result.exitCode ?? 1;
    const stderr = (typeof result.stderr === "string" ? result.stderr : "").trim();
    const stdout = (typeof result.stdout === "string" ? result.stdout : "").trim();

    logger?.debug(`[Script] Exit code: ${exitCode}, timedOut: ${result.timedOut}`);
    if (stdout) {
      logger?.debug(`[Script] Stdout: ${stdout.slice(0, 500)}${stdout.length > 500 ? "..." : ""}`);
    }
    if (stderr) {
      logger?.debug(`[Script] Stderr: ${stderr.slice(0, 500)}${stderr.length > 500 ? "..." : ""}`);
    }

    // Timeout
    if (result.timedOut) {
      return {
        output: { variables: {} },
        exitCode,
        stderr: `script timed out after ${timeout}ms: ${config.run}`,
      };
    }

    // Non-zero exit = failure
    if (exitCode !== 0) {
      const parts: string[] = [];
      if (stderr) parts.push(stderr);
      if (stdout) parts.push(`stdout: ${stdout}`);
      const reason = parts.length > 0 ? parts.join("\n") : `script exited with code ${exitCode}`;
      return {
        output: { variables: {} },
        exitCode,
        stderr: reason,
      };
    }

    // Parse stdout as JSON
    try {
      const output = parseScriptOutput(stdout, location, logger);
      return { output, exitCode: 0, stderr };
    } catch (parseErr: unknown) {
      // Parse/validation errors are returned as failures, not thrown
      const reason = parseErr instanceof Error ? parseErr.message : "failed to parse script output";
      return {
        output: { variables: {} },
        exitCode: 1,
        stderr: reason,
      };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "script execution failed";
    throw new Error(`Script failed: ${config.run}: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function parseScriptOutput(
  stdout: string,
  location: ScriptLocation,
  logger?: Logger
): ScriptOutput {
  if (!stdout) {
    return { variables: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(
      `Script stdout is not valid JSON. Use stderr for debug output.\nStdout: ${stdout.slice(0, 300)}`
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `Script stdout must be a JSON object, got ${Array.isArray(parsed) ? "array" : typeof parsed}`
    );
  }

  const obj = parsed as Record<string, unknown>;
  const output: ScriptOutput = { variables: {} };

  // Extract variables
  if (obj.variables !== undefined) {
    if (typeof obj.variables !== "object" || obj.variables === null || Array.isArray(obj.variables)) {
      throw new Error(`Script "variables" must be a JSON object`);
    }
    for (const [key, value] of Object.entries(obj.variables as Record<string, unknown>)) {
      output.variables[key] = String(value);
    }
  }

  // Extract message
  if (obj.message !== undefined) {
    if (typeof obj.message !== "string") {
      throw new Error(`Script "message" must be a string`);
    }
    output.message = obj.message;
  }

  // Extract reason
  if (obj.reason !== undefined) {
    if (typeof obj.reason !== "string") {
      throw new Error(`Script "reason" must be a string`);
    }
    output.reason = obj.reason;
  }

  // Extract and validate action
  if (obj.action !== undefined) {
    if (typeof obj.action !== "string") {
      throw new Error(`Script "action" must be a string`);
    }
    const action = obj.action as ScriptAction;
    const validActions = VALID_ACTIONS_BY_LOCATION[location];
    if (!validActions.has(action)) {
      const valid = Array.from(validActions).join(", ");
      throw new Error(
        `Invalid action "${action}" for ${location} script. Valid actions: ${valid}`
      );
    }
    output.action = action;
  }

  const fields = Object.keys(output).filter(
    (k) => k !== "variables" || Object.keys(output.variables).length > 0
  );
  logger?.debug(`[Script] Output fields: ${fields.join(", ") || "(empty)"}`);

  return output;
}
