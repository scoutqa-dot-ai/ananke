import { mkdir, writeFile, appendFile } from "fs/promises";
import { join, dirname } from "path";
import type { TimestampedEvent } from "../client/events.js";

/**
 * Get the report directory path for a test file
 */
export function getTestReportDir(
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
 * Ensure the report directory exists
 */
export async function ensureReportDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

/**
 * Write a single event to a step file
 */
export async function writeEvent(
  testDir: string,
  stepIndex: number,
  event: TimestampedEvent
): Promise<void> {
  const filePath = getStepFilePath(testDir, stepIndex);
  await ensureReportDir(dirname(filePath));
  await appendFile(filePath, JSON.stringify(event) + "\n");
}

/**
 * Create an event-writing wrapper for an event generator.
 * Writes each event to the step JSONL file while passing it through.
 */
export function createEventWriter(
  events: AsyncGenerator<TimestampedEvent>,
  testDir: string,
  stepIndex: number
): AsyncGenerator<TimestampedEvent> {
  return writeEvents(events, testDir, stepIndex);
}

async function* writeEvents(
  events: AsyncGenerator<TimestampedEvent>,
  testDir: string,
  stepIndex: number
): AsyncGenerator<TimestampedEvent> {
  await ensureReportDir(testDir);
  const filePath = getStepFilePath(testDir, stepIndex);

  // Clear/create the file
  await writeFile(filePath, "");

  for await (const event of events) {
    await appendFile(filePath, JSON.stringify(event) + "\n");
    yield event;
  }
}
