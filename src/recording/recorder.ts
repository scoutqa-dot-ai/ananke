import { mkdir, writeFile, appendFile } from "fs/promises";
import { join, dirname } from "path";
import type { TimestampedEvent } from "../client/events.js";
import type { Variables } from "../config/interpolate.js";

/**
 * Get the recording directory path for a test file
 */
export function getTestRecordingDir(
  baseDir: string,
  testFilePath: string
): string {
  return join(baseDir, testFilePath);
}

/**
 * Get the path for a turn's event file
 */
export function getTurnFilePath(testDir: string, turnIndex: number): string {
  return join(testDir, `step-${turnIndex}.jsonl`);
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
  event: TimestampedEvent
): Promise<void> {
  const filePath = getTurnFilePath(testDir, turnIndex);
  await ensureRecordingDir(dirname(filePath));
  await appendFile(filePath, JSON.stringify(event) + "\n");
}

/**
 * Get the path for a script step's output file
 */
export function getScriptStepFilePath(testDir: string, stepIndex: number): string {
  return join(testDir, `script-step-${stepIndex}.json`);
}

/**
 * Record script step output
 */
export async function recordScriptStepOutput(
  testDir: string,
  stepIndex: number,
  output: { variables: Variables; skipped?: boolean }
): Promise<void> {
  const filePath = getScriptStepFilePath(testDir, stepIndex);
  await ensureRecordingDir(dirname(filePath));
  await writeFile(filePath, JSON.stringify(output, null, 2));
}

/**
 * Create a recording wrapper for an event generator
 */
export function createRecordingGenerator(
  events: AsyncGenerator<TimestampedEvent>,
  testDir: string,
  turnIndex: number
): AsyncGenerator<TimestampedEvent> {
  return recordEvents(events, testDir, turnIndex);
}

async function* recordEvents(
  events: AsyncGenerator<TimestampedEvent>,
  testDir: string,
  turnIndex: number
): AsyncGenerator<TimestampedEvent> {
  await ensureRecordingDir(testDir);
  const filePath = getTurnFilePath(testDir, turnIndex);

  // Clear/create the file
  await writeFile(filePath, "");

  for await (const event of events) {
    // Store event with its timestamp (already in ananke:ts field)
    await appendFile(filePath, JSON.stringify(event) + "\n");
    yield event;
  }
}
