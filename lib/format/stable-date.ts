/**
 * Dates rendered by components that are server-rendered AND hydrated must not depend on the runtime's locale or time zone:
 * `toLocaleString()` gives "10/9/2026, 10:00:00 AM" on the server (en-US, UTC) and "9/10/2026, 12:00:00" in a Spanish browser
 * (Europe/Madrid), which React reports as a hydration mismatch (error #418) and answers by re-rendering. These helpers always
 * produce the same text for the same instant, in UTC, and say so.
 */
function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "2026-10-09" (UTC) or "—". */
export function formatStableDate(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  return date ? date.toISOString().slice(0, 10) : "—";
}

/** "2026-10-09 10:00 UTC" or "—". */
export function formatStableDateTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  return date ? `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC` : "—";
}
