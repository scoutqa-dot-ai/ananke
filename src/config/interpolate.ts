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
 * Interpolate all string values in an object
 */
export function interpolateObject<T extends Record<string, unknown>>(
  obj: T,
  vars: Variables
): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = interpolate(value, vars);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = interpolateObject(value as Record<string, unknown>, vars);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}
