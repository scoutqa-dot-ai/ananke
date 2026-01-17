export type Variables = Record<string, string>;

/**
 * Interpolate ${VAR} and ${ENV.NAME} in a string
 */
export function interpolate(template: string, vars: Variables): string {
  return template.replace(/\$\{(ENV\.)?(\w+)\}/g, (match, isEnv, name) => {
    if (isEnv) {
      return process.env[name] ?? '';
    }
    return vars[name] ?? '';
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
