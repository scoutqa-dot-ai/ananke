export type Variables = Record<string, string>;

/**
 * Interpolate ${VAR.NAME} and ${ENV.NAME} in a string
 */
export function interpolate(template: string, vars: Variables): string {
  return template.replace(/\$\{(VAR|ENV)\.(\w+)\}/g, (_match, prefix, name) => {
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
      throw new Error(`Variable "${name}" is not defined (referenced as \${VAR.${name}}). Did you forget a hook that sets it?`);
    }
    return value;
  });
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
