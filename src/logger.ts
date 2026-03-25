import pino from "pino";

export type Logger = pino.Logger;

export interface CreateLoggerOptions {
  json?: boolean;
}

const VALID_LEVELS = ["silent", "fatal", "error", "warn", "info", "debug", "trace"] as const;
type PinoLevel = typeof VALID_LEVELS[number];

function resolveLevel(): PinoLevel {
  const env = process.env.ANANKE_LOG_LEVEL;
  if (env && VALID_LEVELS.includes(env as PinoLevel)) {
    return env as PinoLevel;
  }
  return "info";
}

/**
 * Create a pino logger for CLI use.
 *
 * Level is read from ANANKE_LOG_LEVEL env var (default: info).
 * Uses standard pino levels: silent, fatal, error, warn, info, debug, trace.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const level = resolveLevel();

  if (options.json) {
    // JSON mode: logs to stderr so stdout is reserved for results JSON
    return pino({ level }, pino.destination(2));
  }

  const showTimestamp = !!process.env.ANANKE_LOG_TIMESTAMP;

  return pino({
    level,
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        ignore: showTimestamp ? "pid,hostname" : "pid,hostname,time",
        translateTime: showTimestamp ? "HH:MM:ss.l" : false,
      },
    },
  });
}
