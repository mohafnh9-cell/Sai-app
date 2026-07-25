import { FORBIDDEN_LOG_KEYS } from "./types";

const FORBIDDEN_PATTERN = new RegExp(
  FORBIDDEN_LOG_KEYS.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  "i"
);

export function sanitizeOperationalFields(
  fields: Record<string, unknown>
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (FORBIDDEN_PATTERN.test(key)) continue;
    if (typeof value === "string" && value.length > 500) {
      safe[key] = `[redacted:${value.length}chars]`;
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      safe[key] = sanitizeOperationalFields(value as Record<string, unknown>);
      continue;
    }
    safe[key] = value;
  }
  return safe;
}
