/**
 * Strip values that Next.js cannot serialize across the RSC → Client boundary.
 * Removes `undefined` keys recursively; preserves null.
 */
export function toRscSafe<T>(value: T): T {
  if (value === undefined) {
    return value;
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString() as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toRscSafe(item)) as T;
  }

  const source = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(source)) {
    if (nested === undefined) continue;
    sanitized[key] = toRscSafe(nested);
  }

  return sanitized as T;
}

/** Assert props are JSON-safe (for tests). */
export function assertRscSerializable(value: unknown): void {
  JSON.stringify(value);
}
