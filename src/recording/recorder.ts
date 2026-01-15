import { mkdir, writeFile, appendFile } from 'fs/promises';
import { join, dirname } from 'path';
import type { AGUIEvent } from '../client/events.js';
import type { Variables } from '../config/interpolate.js';

/**
 * Get the recording directory path for a test file
 */
export function getTestRecordingDir(baseDir: string, testFilePath: string): string {
  return join(baseDir, testFilePath);
}

/**
 * Get the path for a turn's event file
 */
export function getTurnFilePath(testDir: string, turnIndex: number): string {
  return join(testDir, `turn-${turnIndex}.jsonl`);
}

/**
 * Get the path for a hook's output file
 */
export function getHookFilePath(testDir: string, hookIndex: number): string {
  return join(testDir, `hook-${hookIndex}.json`);
}

/**
 * Ensure the recording directory exists
 */
export async function ensureRecordingDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

/**
 * Record a single event to a turn file
 */
export async function recordEvent(
  testDir: string,
  turnIndex: number,
  event: AGUIEvent
): Promise<void> {
  const filePath = getTurnFilePath(testDir, turnIndex);
  await ensureRecordingDir(dirname(filePath));
  await appendFile(filePath, JSON.stringify(event) + '\n');
}

/**
 * Record hook output variables
 */
export async function recordHookOutput(
  testDir: string,
  hookIndex: number,
  variables: Variables
): Promise<void> {
  const filePath = getHookFilePath(testDir, hookIndex);
  await ensureRecordingDir(dirname(filePath));
  await writeFile(filePath, JSON.stringify(variables, null, 2));
}

/**
 * Create a recording wrapper for an event generator
 */
export function createRecordingGenerator(
  events: AsyncGenerator<AGUIEvent>,
  testDir: string,
  turnIndex: number
): AsyncGenerator<AGUIEvent> {
  return recordEvents(events, testDir, turnIndex);
}

async function* recordEvents(
  events: AsyncGenerator<AGUIEvent>,
  testDir: string,
  turnIndex: number
): AsyncGenerator<AGUIEvent> {
  await ensureRecordingDir(testDir);
  const filePath = getTurnFilePath(testDir, turnIndex);

  // Clear/create the file
  await writeFile(filePath, '');

  for await (const event of events) {
    await appendFile(filePath, JSON.stringify(event) + '\n');
    yield event;
  }
}
