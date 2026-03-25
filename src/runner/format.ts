/**
 * Format a duration in milliseconds to a human-readable string.
 * - < 1s: "123ms"
 * - < 60s: "12.3s"
 * - >= 60s: "1m 45s"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/**
 * Collapse a string to a single line and truncate to maxLen.
 * Replaces newlines with literal \n, carriage returns with \r.
 */
export function truncateLine(value: string, maxLen = 80): string {
  const escaped = value.replace(/\n/g, "\\n").replace(/\r/g, "\\r");
  if (escaped.length <= maxLen) return escaped;
  return `${escaped.slice(0, maxLen)}... (${value.length} chars)`;
}
