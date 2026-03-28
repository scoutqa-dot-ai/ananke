import { execa } from "execa";
import type { Variables } from "../config/interpolate.js";
import type { StepData } from "../types/data.js";
import {
  DEFAULT_SCRIPT_TIMEOUT_MS,
  SLOW_SCRIPT_THRESHOLD_MS,
} from "../constants.js";
import type { Logger } from "../logger.js";
import { formatDuration, truncateLine } from "./format.js";

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
  steps: StepData[];
  variables: Variables;
  stepIndex: number | null;
}

/** Parsed stdout from any script */
export interface ScriptOutput {
  variables: Variables;
}

/** Full result of executing a script */
export interface ScriptResult {
  output: ScriptOutput;
  exitCode: number;
  stderr: string;
}

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
      logger?.debug(
        `Variable "${key}" overridden by ${location} (was: "${old}", now: "${val}")`,
      );
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
  steps?: StepData[];
  variables?: Variables;
  stepIndex?: number | null;
}): AnankeInput {
  return {
    value: opts.value ?? null,
    steps: opts.steps ?? [],
    variables: opts.variables ?? {},
    stepIndex: opts.stepIndex ?? null,
  };
}

/**
 * Execute a script.
 *
 * - Sets ANANKE env var and passes it to stdin
 * - Parses stdout as JSON on exit 0
 * - Returns parsed output, exit code, and stderr
 */
export async function executeScript(
  config: ScriptConfig,
  ananke: AnankeInput,
  opts?: { logger?: Logger; extraEnv?: Record<string, string> },
): Promise<ScriptResult> {
  const { logger } = opts ?? {};
  const timeout = config.timeout_ms ?? DEFAULT_SCRIPT_TIMEOUT_MS;
  const anankeJson = JSON.stringify(ananke);

  logger?.debug(
    `[script] Running: ${config.run} (timeout=${timeout}ms)`,
  );

  // Build env: process.env + ANANKE + config.env + extraEnv
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ANANKE: anankeJson,
    ...config.env,
    ...opts?.extraEnv,
  };

  const startTime = Date.now();
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

    const elapsed = Date.now() - startTime;
    const exitCode = result.exitCode ?? 1;
    const stderr = (
      typeof result.stderr === "string" ? result.stderr : ""
    ).trim();
    const stdout = (
      typeof result.stdout === "string" ? result.stdout : ""
    ).trim();

    if (result.timedOut) {
      logger?.error(
        `[script] Timeout: ${config.run} after ${formatDuration(elapsed)}`,
      );
      return {
        output: { variables: {} },
        exitCode,
        stderr: `script timed out after ${timeout}ms: ${config.run}`,
      };
    } else if (elapsed >= SLOW_SCRIPT_THRESHOLD_MS) {
      logger?.warn(
        `[script] Slow script: ${config.run} took ${formatDuration(elapsed)} (exit=${exitCode})`,
      );
    } else {
      logger?.debug(`[script] Exit code: ${exitCode}`);
    }
    if (stdout) {
      logger?.debug(`[script] stdout: ${truncateLine(stdout)}`);
    }
    if (stderr) {
      logger?.debug(`[script] stderr: ${truncateLine(stderr)}`);
    }

    // Non-zero exit = failure
    if (exitCode !== 0) {
      const parts: string[] = [];
      if (stderr) parts.push(stderr);
      if (stdout) parts.push(`stdout: ${stdout}`);
      const reason =
        parts.length > 0
          ? parts.join("\n")
          : `script exited with code ${exitCode}`;
      return {
        output: { variables: {} },
        exitCode,
        stderr: reason,
      };
    }

    // Parse stdout as JSON
    try {
      const output = parseScriptOutput(stdout, logger);
      return { output, exitCode: 0, stderr };
    } catch (parseErr: unknown) {
      // Parse/validation errors are returned as failures, not thrown
      const reason =
        parseErr instanceof Error
          ? parseErr.message
          : "failed to parse script output";
      return {
        output: { variables: {} },
        exitCode: 1,
        stderr: reason,
      };
    }
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "script execution failed";
    throw new Error(`Script failed: ${config.run}: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function parseScriptOutput(
  stdout: string,
  logger?: Logger,
): ScriptOutput {
  if (!stdout) {
    return { variables: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(
      `Script stdout is not valid JSON. Use stderr for debug output.\nStdout: ${stdout.slice(0, 300)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `Script stdout must be a JSON object, got ${Array.isArray(parsed) ? "array" : typeof parsed}`,
    );
  }

  const obj = parsed as Record<string, unknown>;
  const output: ScriptOutput = { variables: {} };

  // Extract variables
  if (obj.variables !== undefined) {
    if (
      typeof obj.variables !== "object" ||
      obj.variables === null ||
      Array.isArray(obj.variables)
    ) {
      throw new Error(`Script "variables" must be a JSON object`);
    }
    for (const [key, value] of Object.entries(
      obj.variables as Record<string, unknown>,
    )) {
      output.variables[key] = String(value);
    }
  }

  const varCount = Object.keys(output.variables).length;
  if (varCount > 0) {
    logger?.debug(`[script] Variables: ${Object.keys(output.variables).join(", ")}`);
  }

  return output;
}
