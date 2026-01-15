import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import type { AGUIEvent } from '../client/events.js';
import type { Variables } from '../config/interpolate.js';
import { getTestRecordingDir, getTurnFilePath, getHookFilePath } from './recorder.js';

/**
 * Check if a recording exists for a test
 */
export function hasRecording(baseDir: string, testFilePath: string): boolean {
  const testDir = getTestRecordingDir(baseDir, testFilePath);
  return existsSync(testDir);
}

/**
 * Check if a turn recording exists
 */
export function hasTurnRecording(baseDir: string, testFilePath: string, turnIndex: number): boolean {
  const testDir = getTestRecordingDir(baseDir, testFilePath);
  const filePath = getTurnFilePath(testDir, turnIndex);
  return existsSync(filePath);
}

/**
 * Load hook output variables from recording
 */
export async function loadHookOutput(
  baseDir: string,
  testFilePath: string,
  hookIndex: number
): Promise<Variables | null> {
  const testDir = getTestRecordingDir(baseDir, testFilePath);
  const filePath = getHookFilePath(testDir, hookIndex);

  if (!existsSync(filePath)) {
    return null;
  }

  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as Variables;
}

/**
 * Create a replay event generator for a turn
 */
export async function* replayEvents(
  baseDir: string,
  testFilePath: string,
  turnIndex: number
): AsyncGenerator<AGUIEvent> {
  const testDir = getTestRecordingDir(baseDir, testFilePath);
  const filePath = getTurnFilePath(testDir, turnIndex);

  if (!existsSync(filePath)) {
    throw new Error(`Recording not found: ${filePath}`);
  }

  const content = await readFile(filePath, 'utf-8');
  const lines = content.trim().split('\n');

  for (const line of lines) {
    if (line) {
      yield JSON.parse(line) as AGUIEvent;
    }
  }
}
