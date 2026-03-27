import { readFile } from "fs/promises";
import { existsSync } from "fs";
import type { TimestampedEvent } from "../client/events.js";
import {
  getTestRecordingDir,
  getStepFilePath,
} from "./recorder.js";

/**
 * Check if a recording exists for a test
 */
export function hasRecording(baseDir: string, testFilePath: string): boolean {
  const testDir = getTestRecordingDir(baseDir, testFilePath);
  return existsSync(testDir);
}

/**
 * Check if a step recording exists
 */
export function hasStepRecording(
  baseDir: string,
  testFilePath: string,
  stepIndex: number
): boolean {
  const testDir = getTestRecordingDir(baseDir, testFilePath);
  const filePath = getStepFilePath(testDir, stepIndex);
  return existsSync(filePath);
}

/**
 * Create a replay event generator for a step
 * Events are returned with their original timestamps preserved
 */
export async function* replayEvents(
  baseDir: string,
  testFilePath: string,
  stepIndex: number
): AsyncGenerator<TimestampedEvent> {
  const testDir = getTestRecordingDir(baseDir, testFilePath);
  const filePath = getStepFilePath(testDir, stepIndex);

  if (!existsSync(filePath)) {
    throw new Error(`Recording not found: ${filePath}`);
  }

  const content = await readFile(filePath, "utf-8");
  const lines = content.trim().split("\n");

  for (const line of lines) {
    if (line) {
      yield JSON.parse(line) as TimestampedEvent;
    }
  }
}
