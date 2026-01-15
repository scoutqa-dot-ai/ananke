import { execa, type ResultPromise } from 'execa';
import type { Hook } from '../types/index.js';
import type { Variables } from '../config/interpolate.js';

const DEFAULT_TIMEOUT_MS = 30000;

export interface HookResult {
  variables: Variables;
  stdout: string;
}

/**
 * Execute a single hook and parse its JSON output
 */
export async function executeHook(hook: Hook): Promise<HookResult> {
  const [cmd, ...args] = hook.cmd;
  const timeout = hook.timeout_ms ?? DEFAULT_TIMEOUT_MS;

  let subprocess: ResultPromise;
  try {
    subprocess = execa(cmd, args, {
      timeout,
      reject: true,
    });
  } catch (err) {
    throw new Error(`Failed to start hook: ${hook.cmd.join(' ')}`);
  }

  const result = await subprocess;

  const stdoutRaw = result.stdout;
  const stdout = typeof stdoutRaw === 'string' ? stdoutRaw.trim() : '';
  if (!stdout) {
    return { variables: {}, stdout: '' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(
      `Hook output is not valid JSON: ${hook.cmd.join(' ')}\nOutput: ${stdout}`
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `Hook output must be a JSON object: ${hook.cmd.join(' ')}\nOutput: ${stdout}`
    );
  }

  // Convert all values to strings for the variable map
  const variables: Variables = {};
  for (const [key, value] of Object.entries(parsed)) {
    variables[key] = String(value);
  }

  return { variables, stdout };
}

/**
 * Execute all hooks and merge their outputs
 */
export async function executeHooks(hooks: Hook[]): Promise<Variables> {
  const variables: Variables = {};

  for (const hook of hooks) {
    const result = await executeHook(hook);
    Object.assign(variables, result.variables);
  }

  return variables;
}
