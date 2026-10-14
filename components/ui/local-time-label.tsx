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

export function LocalTimeLabel({
  iso,
  kind,
  format,
  className,
}: {
  iso: string | Date;
  /** What the deterministic first render shows: the time of day, the date, or both (always UTC). */
  kind: LocalTimeKind;
  /** The viewer-local text (called only after mount). */
  format: (instant: Date) => string;
  className?: string;
}) {
  const mounted = useIsMounted();
  const instant = iso instanceof Date ? iso : new Date(iso);
  const valid = !Number.isNaN(instant.getTime());
  const label = !valid ? "—" : mounted ? format(instant) : STABLE[kind](instant);
  return (
    <time className={className} dateTime={valid ? instant.toISOString() : undefined} title={valid ? formatStableDateTime(instant) : undefined}>
      {label}
    </time>
  );
}
