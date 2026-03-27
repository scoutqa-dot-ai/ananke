import { readFile } from "fs/promises";
import { existsSync } from "fs";
import type { TimestampedEvent } from "../client/events.js";
import type { Variables } from "../config/interpolate.js";
import {
  getTestRecordingDir,
  getTurnFilePath,
  getScriptStepFilePath,
} from "./recorder.js";

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
export function hasTurnRecording(
  baseDir: string,
  testFilePath: string,
  turnIndex: number
): boolean {
  const testDir = getTestRecordingDir(baseDir, testFilePath);
  const filePath = getTurnFilePath(testDir, turnIndex);
  return existsSync(filePath);
}

/**
 * Load script step output from recording
 */
export async function loadScriptStepOutput(
  baseDir: string,
  testFilePath: string,
  stepIndex: number
): Promise<{ variables: Variables; skipped?: boolean } | null> {
  const testDir = getTestRecordingDir(baseDir, testFilePath);
  const filePath = getScriptStepFilePath(testDir, stepIndex);

  if (!existsSync(filePath)) {
    return null;
  }

  const content = await readFile(filePath, "utf-8");
  return JSON.parse(content);
}

/**
 * Create a replay event generator for a turn
 * Events are returned with their original timestamps preserved
 */
export async function* replayEvents(
  baseDir: string,
  testFilePath: string,
  turnIndex: number
): AsyncGenerator<TimestampedEvent> {
  const testDir = getTestRecordingDir(baseDir, testFilePath);
  const filePath = getTurnFilePath(testDir, turnIndex);

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
