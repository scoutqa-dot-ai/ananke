import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import yaml from 'js-yaml';
import { ProjectConfigSchema, type ProjectConfig } from '../types/index.js';

const CONFIG_FILENAME = 'ananke.config.yaml';

/**
 * Find config file by walking up from cwd
 */
function findConfigFile(startDir: string): string | null {
  let dir = startDir;
  while (true) {
    const configPath = resolve(dir, CONFIG_FILENAME);
    if (existsSync(configPath)) {
      return configPath;
    }
    const parentDir = dirname(dir);
    if (parentDir === dir) {
      return null;
    }
    dir = parentDir;
  }
}

export interface LoadConfigOptions {
  configPath?: string;
  cwd?: string;
}

export interface LoadConfigResult {
  config: ProjectConfig;
  configPath: string;
}

/**
 * Load and validate project config
 */
export function loadConfig(options: LoadConfigOptions = {}): LoadConfigResult {
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath ?? findConfigFile(cwd);

  if (!configPath) {
    throw new Error(
      `Config file not found. Create ${CONFIG_FILENAME} in your project root.`
    );
  }

  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const content = readFileSync(configPath, 'utf-8');
  const raw = yaml.load(content);

  const result = ProjectConfigSchema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Invalid config file:\n${errors}`);
  }

  return {
    config: result.data,
    configPath,
  };
}
