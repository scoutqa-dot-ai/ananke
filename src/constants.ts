// ---------------------------------------------------------------------------
// Timeouts & retry defaults (single source of truth)
// ---------------------------------------------------------------------------

/** Script assertion / script turn timeout */
export const DEFAULT_SCRIPT_TIMEOUT_MS = 300_000;

/** AG-UI HTTP / WebSocket client timeout */
export const DEFAULT_CLIENT_TIMEOUT_MS = 600_000;

/** Delay between AG-UI HTTP retries */
export const DEFAULT_RETRY_DELAY_MS = 1_000;

/** Max AG-UI HTTP retries on empty response */
export const DEFAULT_MAX_RETRIES = 3;
