import { readFile } from "fs/promises";
import { existsSync } from "fs";
import type { TimestampedEvent } from "../client/events.js";
import {
  getTestReportDir,
  getStepFilePath,
} from "./writer.js";

/**
 * Check if a report exists for a test
 */
export function hasReport(baseDir: string, testFilePath: string): boolean {
  const testDir = getTestReportDir(baseDir, testFilePath);
  return existsSync(testDir);
}

/**
 * Check if step events exist for replay
 */
export function hasStepEvents(
  baseDir: string,
  testFilePath: string,
  stepIndex: number
): boolean {
  const testDir = getTestReportDir(baseDir, testFilePath);
  const filePath = getStepFilePath(testDir, stepIndex);
  return existsSync(filePath);
}

/**
 * Create a replay event generator for a step.
 * Events are returned with their original timestamps preserved.
 */
export async function* replayEvents(
  baseDir: string,
  testFilePath: string,
  stepIndex: number
): AsyncGenerator<TimestampedEvent> {
  const testDir = getTestReportDir(baseDir, testFilePath);
  const filePath = getStepFilePath(testDir, stepIndex);

  if (!existsSync(filePath)) {
    throw new Error(`Step events not found: ${filePath}`);
  }

  const content = await readFile(filePath, "utf-8");
  const lines = content.trim().split("\n");

  for (const line of lines) {
    if (line) {
      yield JSON.parse(line) as TimestampedEvent;
    }
  }
}
