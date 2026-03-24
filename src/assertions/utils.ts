/**
 * Stringify a value for display in error messages
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

/**
 * Get a nested value from an object using dot-notation path.
 * Supports array indexing with bracket notation (e.g., "items[0].name").
 * Returns { found: true, value } or { found: false }.
 */
export function getNestedValue(
  obj: unknown,
  path: string
): { found: true; value: unknown } | { found: false } {
  // Parse path segments: "a.b[0].c" -> ["a", "b", "0", "c"]
  const parts = path.split(/\./).flatMap((segment) => {
    // Split bracket notation: "items[0]" -> ["items", "0"]
    const bracketMatch = segment.match(/^([^[]*)\[(\d+)\]$/);
    if (bracketMatch) {
      const result: string[] = [];
      if (bracketMatch[1]) result.push(bracketMatch[1]);
      result.push(bracketMatch[2]);
      return result;
    }
    return [segment];
  });

  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) {
      return { found: false };
    }
    if (typeof current !== "object") {
      return { found: false };
    }
    if (Array.isArray(current)) {
      const index = Number(part);
      if (Number.isNaN(index) || index < 0 || index >= current.length) {
        return { found: false };
      }
      current = current[index];
    } else {
      if (!Object.prototype.hasOwnProperty.call(current, part)) {
        return { found: false };
      }
      current = (current as Record<string, unknown>)[part];
    }
  }

  return { found: true, value: current };
}

/**
 * Truncate a string for display in assertion results
 */
export function truncate(value: string, maxLen = 100): string {
  if (value.length > maxLen) {
    return `${value.slice(0, maxLen)}...`;
  }
  return value;
}

/**
 * Get a human-readable type name for a value
 */
export function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
