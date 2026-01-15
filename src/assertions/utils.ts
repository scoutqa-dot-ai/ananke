/**
 * Stringify a value for regex matching
 */
export function stringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  return JSON.stringify(value);
}

/**
 * Parse a pattern string into regex and flags
 * Supports /pattern/flags syntax for flags (e.g., /hello/i for case insensitive)
 */
export function parsePattern(pattern: string): RegExp {
  const match = pattern.match(/^\/(.+)\/([gimsuy]*)$/);
  if (match) {
    return new RegExp(match[1], match[2]);
  }
  return new RegExp(pattern);
}

/**
 * Test if a value matches a regex pattern
 * Automatically stringifies non-string values
 * Supports /pattern/flags syntax for flags (e.g., /hello/i for case insensitive)
 */
export function matchesPattern(value: unknown, pattern: string): boolean {
  const str = stringify(value);
  return parsePattern(pattern).test(str);
}
