import type { AppLocale } from "./types";

export function formatLocalizedDate(
  locale: AppLocale,
  date: Date | string | null
): string {
  if (!date) return "";
  const tag = locale === "es" ? "es-ES" : "en-US";
  return new Intl.DateTimeFormat(tag, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date));
}

export function formatRelativeLocalized(
  locale: AppLocale,
  date: Date | string | null,
  labels: {
    never: string;
    justNow: string;
    minutesAgo: string;
    hoursAgo: string;
    daysAgo: string;
  },
  /** The instant "now" is measured at. Defaults to the clock: pass it when the text takes part in hydration. */
  now: Date = new Date()
): string {
  if (!date) return labels.never;
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return labels.justNow;
  if (diffMins < 60) return labels.minutesAgo.replace("{count}", String(diffMins));
  if (diffHours < 24) return labels.hoursAgo.replace("{count}", String(diffHours));
  if (diffDays < 7) return labels.daysAgo.replace("{count}", String(diffDays));
  return formatLocalizedDate(locale, date);
}

export function formatDurationMinutes(locale: AppLocale, minutes: number): string {
  const tag = locale === "es" ? "es-ES" : "en-US";
  return new Intl.NumberFormat(tag).format(minutes);
}
