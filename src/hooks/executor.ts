import { execa, type ResultPromise } from 'execa';
import type { Hook } from '../types/index.js';
import { interpolate, type Variables } from '../config/interpolate.js';
import type { Logger } from '../logger.js';

const DEFAULT_TIMEOUT_MS = 30000;

export interface HookResult {
  variables: Variables;
  stdout: string;
}

export interface ExecuteHookOptions {
  currentVars?: Variables;
  logger?: Logger;
}

/**
 * Execute a single hook and parse its JSON output
 * @param hook The hook configuration
 * @param options Execution options (variables, logger)
 */
export async function executeHook(hook: Hook, options: ExecuteHookOptions = {}): Promise<HookResult> {
  const { currentVars = {}, logger } = options;
  const [cmd, ...args] = hook.cmd;
  const timeout = hook.timeout_ms ?? DEFAULT_TIMEOUT_MS;

  logger?.trace(`[Hook] Running: ${hook.cmd.join(' ')}`);

  // Build environment with interpolated values
  let env: NodeJS.ProcessEnv | undefined;
  if (hook.env) {
    env = { ...process.env };
    for (const [key, value] of Object.entries(hook.env)) {
      const interpolated = interpolate(value, currentVars);
      env[key] = interpolated;
      logger?.trace(`[Hook] Env: ${key}=${interpolated}`);
    }
  }

  let subprocess: ResultPromise;
  try {
    subprocess = execa(cmd, args, {
      timeout,
      reject: true,
      env,
    });
  } catch (err) {
    logger?.trace(`[Hook] Failed to start: ${(err as Error).message}`);
    throw new Error(`Failed to start hook: ${hook.cmd.join(' ')}`);
  }

  const result = await subprocess;
  logger?.trace(`[Hook] Exit code: ${result.exitCode}`);

  // Log stderr if present (useful for debugging)
  const stderrRaw = result.stderr;
  const stderr = typeof stderrRaw === 'string' ? stderrRaw.trim() : '';
  if (stderr) {
    logger?.trace(`[Hook] Stderr: ${stderr.slice(0, 200)}${stderr.length > 200 ? '...' : ''}`);
  }

  const stdoutRaw = result.stdout;
  const stdout = typeof stdoutRaw === 'string' ? stdoutRaw.trim() : '';
  if (!stdout) {
    logger?.trace(`[Hook] No output`);
    return { variables: {}, stdout: '' };
  }

  logger?.trace(`[Hook] Stdout: ${stdout.slice(0, 200)}${stdout.length > 200 ? '...' : ''}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    let errMsg = `Hook output is not valid JSON: ${hook.cmd.join(' ')}\nStdout: ${stdout}`;
    if (stderr) {
      errMsg += `\nStderr: ${stderr}`;
    }
    throw new Error(errMsg);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    let errMsg = `Hook output must be a JSON object: ${hook.cmd.join(' ')}\nStdout: ${stdout}`;
    if (stderr) {
      errMsg += `\nStderr: ${stderr}`;
    }
    throw new Error(errMsg);
  }

  // Convert all values to strings for the variable map
  const variables: Variables = {};
  for (const [key, value] of Object.entries(parsed)) {
    variables[key] = String(value);
  }

  logger?.trace(`[Hook] Variables: ${Object.keys(variables).join(', ') || '(none)'}`);
  return { variables, stdout };
}

export interface ExecuteHooksOptions {
  logger?: Logger;
}

/**
 * Execute all hooks and merge their outputs
 */
export async function executeHooks(hooks: Hook[], options: ExecuteHooksOptions = {}): Promise<Variables> {
  const variables: Variables = {};

  for (const hook of hooks) {
    const result = await executeHook(hook, { currentVars: variables, logger: options.logger });
    Object.assign(variables, result.variables);
  }

  return variables;
}
