"use client";

import { useSyncExternalStore } from "react";
import { formatStableDate, formatStableDateTime, formatStableTime } from "@/lib/format/stable-date";

/**
 * Dates and times shown in the viewer's own time zone cannot be part of the server-rendered HTML AND of the first client render: the server
 * formats them in ITS zone (UTC) and the browser in the viewer's ("10:17" against "12:17" in Madrid), so the two texts differ on every load
 * and React reports "Hydration failed because the server rendered text didn't match the client" (minified error #418, args text).
 *
 * The first render (server HTML and hydration alike) is therefore DETERMINISTIC: the same instant in UTC, labelled as such. Once mounted
 * it becomes the viewer's local text. The full instant stays available in `title` / `dateTime`.
 */
const subscribe = () => () => undefined;
const getClientSnapshot = (): boolean => true;
const getServerSnapshot = (): boolean => false;

export function useIsMounted(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}

export type LocalTimeKind = "time" | "date" | "datetime";

const STABLE: Record<LocalTimeKind, (value: Date) => string> = {
  time: formatStableTime,
  date: formatStableDate,
  datetime: formatStableDateTime,
};

/** "Europe/Madrid", or null when the runtime does not expose it. Only called after mount. */
function viewerZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function LocalTimeLabel({
  iso,
  kind,
  format,
  className,
}: {
  /** An absent (null/undefined) or invalid instant renders "—": never "Invalid Date" or "NaN". */
  iso: string | Date | null | undefined;
  /** What the deterministic first render shows: the time of day, the date, or both (always UTC). */
  kind: LocalTimeKind;
  /** The viewer-local text (called only after mount). */
  format: (instant: Date) => string;
  className?: string;
}) {
  const mounted = useIsMounted();
  const instant = iso == null || iso === "" ? null : iso instanceof Date ? iso : new Date(iso);
  const valid = instant !== null && !Number.isNaN(instant.getTime());
  if (!valid) return <span className={className}>—</span>;
  const label = mounted ? format(instant) : STABLE[kind](instant);
  // The title always carries the FULL instant in UTC; once mounted it also says which zone the shown local text is in.
  const zone = mounted ? viewerZone() : null;
  const title = zone ? `${formatStableDateTime(instant)} · ${label} (${zone})` : formatStableDateTime(instant);
  return (
    <time className={className} dateTime={instant.toISOString()} title={title}>
      {label}
    </time>
  );
}
