// ---------------------------------------------------------------------------
// Timeouts & retry defaults (single source of truth)
//
// Every constant can be overridden via an ANANKE_ env var.
// ---------------------------------------------------------------------------

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

/** Script assertion / script step timeout */
export const DEFAULT_SCRIPT_TIMEOUT_MS = envInt("ANANKE_SCRIPT_TIMEOUT_MS", 300_000);

/** Protocol client HTTP / WebSocket timeout */
export const DEFAULT_CLIENT_TIMEOUT_MS = envInt("ANANKE_CLIENT_TIMEOUT_MS", 600_000);

/** Delay between protocol client HTTP retries */
export const DEFAULT_RETRY_DELAY_MS = envInt("ANANKE_RETRY_DELAY_MS", 1_000);

/** Threshold for logging slow scripts */
export const SLOW_SCRIPT_THRESHOLD_MS = envInt("ANANKE_SLOW_SCRIPT_THRESHOLD_MS", 3_000);

/** Threshold for logging slow time to first text */
export const SLOW_TTF_TEXT_THRESHOLD_MS = envInt("ANANKE_SLOW_TTF_TEXT_THRESHOLD_MS", 5_000);

/** Max protocol client HTTP retries on empty response */
export const DEFAULT_MAX_RETRIES = envInt("ANANKE_MAX_RETRIES", 3);

/** WSS idle threshold before HTTP poll fallback activates */
export const DEFAULT_POLL_IDLE_THRESHOLD_MS = envInt("ANANKE_POLL_IDLE_THRESHOLD_MS", 60_000);

/** HTTP poll interval once fallback is active */
export const DEFAULT_POLL_INTERVAL_MS = envInt("ANANKE_POLL_INTERVAL_MS", 5_000);

/** STOMP reconnect delay (ms). 0 disables reconnection. */
export const DEFAULT_STOMP_RECONNECT_DELAY_MS = envInt("ANANKE_STOMP_RECONNECT_DELAY_MS", 1_000);

/** STOMP heartbeat interval (ms) for both directions. 0 disables heartbeats. */
export const DEFAULT_STOMP_HEARTBEAT_MS = envInt("ANANKE_STOMP_HEARTBEAT_MS", 10_000);

/** Background poll interval (ms) — periodic catch-up poll regardless of idle. 0 disables. */
export const DEFAULT_BACKGROUND_POLL_INTERVAL_MS = envInt("ANANKE_BACKGROUND_POLL_INTERVAL_MS", 0);
