export type Variables = Record<string, string>;

/** Pattern matching ${VAR.NAME} and ${ENV.NAME} references */
const REF_PATTERN = /\$\{(VAR|ENV)\.(\w+)\}/g;

/**
 * Interpolate ${VAR.NAME} and ${ENV.NAME} in a string
 */
export function interpolate(template: string, vars: Variables): string {
  return template.replace(REF_PATTERN, (_match, prefix, name) => {
    if (prefix === "ENV") {
      const value = process.env[name];
      if (value === undefined) {
        throw new Error(`Environment variable "${name}" is not set (referenced as \${ENV.${name}})`);
      }
      return value;
    }
    // prefix === "VAR"
    const value = vars[name];
    if (value === undefined) {
      throw new Error(`Variable "${name}" is not defined (referenced as \${VAR.${name}}). Did you forget a script step that sets it?`);
    }
    return value;
  });
}

/**
 * Extract all ${ENV.NAME} references from a value (string, array, or object tree).
 * Returns a deduplicated array of environment variable names.
 */
export function extractEnvRefs(value: unknown): string[] {
  const refs: string[] = [];
  collectRefs(value, "ENV", refs);
  return [...new Set(refs)];
}

function collectRefs(value: unknown, prefix: string, refs: string[]): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(REF_PATTERN)) {
      if (match[1] === prefix) {
        refs.push(match[2]);
      }
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectRefs(item, prefix, refs);
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) {
      collectRefs(v, prefix, refs);
    }
  }
}

/**
 * Validate that all ${ENV.NAME} references in a value tree are set.
 * Throws with all missing variables listed.
 */
export function validateEnvRefs(value: unknown): void {
  const refs = extractEnvRefs(value);
  const missing = refs.filter(name => process.env[name] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Missing environment variable${missing.length > 1 ? 's' : ''}: ${missing.map(n => `\${ENV.${n}}`).join(', ')}`
    );
  }
}

/**
 * Interpolate all string values in an object or array
 */
export function interpolateObject<T extends Record<string, unknown>>(
  obj: T,
  vars: Variables
): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = interpolateValue(value, vars);
  }
  return result as T;
}

/**
 * Interpolate a single value (string, array, object, or primitive)
 */
function interpolateValue(value: unknown, vars: Variables): unknown {
  if (typeof value === 'string') {
    return interpolate(value, vars);
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateValue(item, vars));
  }
  if (typeof value === 'object' && value !== null) {
    return interpolateObject(value as Record<string, unknown>, vars);
  }
  return value;
}
