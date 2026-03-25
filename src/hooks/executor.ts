import type { Hook } from '../types/index.js';
import { interpolate, type Variables } from '../config/interpolate.js';
import {
  executeScript,
  buildAnankeInput,
  type ScriptOutput,
} from '../runner/script.js';
import type { Logger } from '../logger.js';

export interface HookResult {
  variables: Variables;
  stdout: string;
  action?: ScriptOutput['action'];
}

export interface ExecuteHookOptions {
  currentVars?: Variables;
  logger?: Logger;
}

/**
 * Execute a single hook using the unified script contract.
 */
export async function executeHook(hook: Hook, options: ExecuteHookOptions = {}): Promise<HookResult> {
  const { currentVars = {}, logger } = options;

  logger?.trace(`[Hook] Running: ${hook.cmd.join(' ')}`);

  // Build interpolated env from hook.env
  const extraEnv: Record<string, string> = {};
  if (hook.env) {
    for (const [key, value] of Object.entries(hook.env)) {
      const interpolated = interpolate(value, currentVars);
      extraEnv[key] = interpolated;
      logger?.trace(`[Hook] Env: ${key}=${interpolated}`);
    }
  }

  // Hooks use cmd array — preserve argv boundaries via args mode
  const [cmd, ...args] = hook.cmd;
  const config = {
    run: cmd,
    args,
    timeout_ms: hook.timeout_ms ?? 30_000,
  };

  const ananke = buildAnankeInput({ variables: currentVars });

  const result = await executeScript(config, ananke, 'hook', {
    logger,
    extraEnv,
  });

  // Non-zero exit code = failure
  if (result.exitCode !== 0) {
    throw new Error(`Hook failed: ${hook.cmd.join(' ')}\n${result.stderr}`);
  }

  logger?.trace(`[Hook] Variables: ${Object.keys(result.output.variables).join(', ') || '(none)'}`);

  return {
    variables: result.output.variables,
    stdout: JSON.stringify(result.output),
    action: result.output.action,
  };
}

export interface ExecuteHooksOptions {
  logger?: Logger;
}

/**
 * Execute all hooks and merge their outputs.
 * Supports skip_hook (skip one hook) and skip_test (stop test with SKIP).
 */
export async function executeHooks(hooks: Hook[], options: ExecuteHooksOptions = {}): Promise<{ variables: Variables; skipped: boolean }> {
  const variables: Variables = {};
  const { logger } = options;

  for (const hook of hooks) {
    const result = await executeHook(hook, { currentVars: variables, logger });

    if (result.action === 'skip_test') {
      logger?.debug('[Hook] skip_test — stopping test');
      return { variables, skipped: true };
    }

    if (result.action === 'skip_hook') {
      logger?.debug('[Hook] skip_hook — skipping this hook');
      continue;
    }

    Object.assign(variables, result.variables);
  }

  return { variables, skipped: false };
}
