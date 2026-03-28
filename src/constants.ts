// ---------------------------------------------------------------------------
// Timeouts & retry defaults (single source of truth)
// ---------------------------------------------------------------------------

/** Script assertion / script step timeout */
export const DEFAULT_SCRIPT_TIMEOUT_MS = 300_000;

/** Protocol client HTTP / WebSocket timeout */
export const DEFAULT_CLIENT_TIMEOUT_MS = 600_000;

/** Delay between protocol client HTTP retries */
export const DEFAULT_RETRY_DELAY_MS = 1_000;

/** Threshold for logging slow scripts */
export const SLOW_SCRIPT_THRESHOLD_MS = 3_000;

/** Threshold for logging slow time to first text */
export const SLOW_TTF_TEXT_THRESHOLD_MS = 5_000;

/** Max protocol client HTTP retries on empty response */
export const DEFAULT_MAX_RETRIES = 3;
