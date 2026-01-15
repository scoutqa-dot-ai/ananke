import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { glob } from 'node:fs/promises';
import yaml from 'js-yaml';
import { TestFileSchema, type TestFile } from '../types/index.js';

export interface LoadTestResult {
  test: TestFile;
  filePath: string;
}

/**
 * Load and validate a single test file
 */
export function loadTestFile(filePath: string): LoadTestResult {
  if (!existsSync(filePath)) {
    throw new Error(`Test file not found: ${filePath}`);
  }

  const content = readFileSync(filePath, 'utf-8');
  const raw = yaml.load(content);

  const result = TestFileSchema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Invalid test file ${filePath}:\n${errors}`);
  }

  return {
    test: result.data,
    filePath,
  };
}

/**
 * Find test files matching glob pattern
 */
export async function findTestFiles(
  patterns: string[],
  cwd: string
): Promise<string[]> {
  const files: string[] = [];

  for (const pattern of patterns) {
    const matches = glob(pattern, { cwd });
    for await (const match of matches) {
      files.push(resolve(cwd, match));
    }
  }

  return [...new Set(files)].sort();
}

/**
 * Default test file patterns
 */
export const DEFAULT_TEST_PATTERNS = ['**/*.test.yaml', '**/*.test.yml'];
