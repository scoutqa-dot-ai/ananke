import { mkdir, writeFile, appendFile } from "fs/promises";
import { join, dirname } from "path";
import type { TimestampedEvent } from "../client/events.js";

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
 * Get the path for a step's event file
 */
export function getStepFilePath(testDir: string, stepIndex: number): string {
  return join(testDir, `step-${stepIndex}.jsonl`);
}

/**
 * Ensure the recording directory exists
 */
export async function ensureRecordingDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

/**
 * Record a single event to a step file
 */
export async function recordEvent(
  testDir: string,
  stepIndex: number,
  event: TimestampedEvent
): Promise<void> {
  const filePath = getStepFilePath(testDir, stepIndex);
  await ensureRecordingDir(dirname(filePath));
  await appendFile(filePath, JSON.stringify(event) + "\n");
}

/**
 * Create a recording wrapper for an event generator
 */
export function createRecordingGenerator(
  events: AsyncGenerator<TimestampedEvent>,
  testDir: string,
  stepIndex: number
): AsyncGenerator<TimestampedEvent> {
  return recordEvents(events, testDir, stepIndex);
}

async function* recordEvents(
  events: AsyncGenerator<TimestampedEvent>,
  testDir: string,
  stepIndex: number
): AsyncGenerator<TimestampedEvent> {
  await ensureRecordingDir(testDir);
  const filePath = getStepFilePath(testDir, stepIndex);

  // Clear/create the file
  await writeFile(filePath, "");

  for await (const event of events) {
    // Store event with its timestamp (already in ananke:ts field)
    await appendFile(filePath, JSON.stringify(event) + "\n");
    yield event;
  }
}
