"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { formatStableDateTime } from "@/lib/format/stable-date";

/**
 * Times printed relative to now ("hace 20 h") cannot be part of the server-rendered HTML AND of the first client render: the server
 * computes them with its clock and the client recomputes them seconds later while hydrating, and when a minute or hour boundary falls in
 * between the two texts differ (React error #418, "text didn't match").
 *
 * So the first render (server HTML and hydration alike) is DETERMINISTIC: the full date in UTC ("2026-10-13 10:17 UTC"), a pure function of
 * the instant. Once mounted, the label becomes the relative text and is refreshed every minute. The full date stays available in the
 * element's `title` and the machine-readable instant in `dateTime`.
 */
const MINUTE_MS = 60_000;

function subscribe(onChange: () => void): () => void {
  const id = setInterval(onChange, MINUTE_MS);
  return () => clearInterval(id);
}
// The current minute: stable inside a minute, a new value every minute. `null` on the server and during hydration.
const getClientSnapshot = (): number | null => Math.floor(Date.now() / MINUTE_MS);
const getServerSnapshot = (): number | null => null;

export function useMinuteClock(): number | null {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}

export function RelativeTimeLabel({
  iso,
  format,
  className,
  children,
}: {
  iso: string | Date;
  /** Relative text for `now` (called only after mount). */
  format: (now: Date) => string;
  className?: string;
  /** Optional: put the label inside a sentence ("Last review: {label}"). */
  children?: (label: string) => ReactNode;
}) {
  const minute = useMinuteClock();
  const instant = iso instanceof Date ? iso : new Date(iso);
  const valid = !Number.isNaN(instant.getTime());
  const absolute = valid ? formatStableDateTime(instant) : "—";
  const label = minute === null || !valid ? absolute : format(new Date());

  if (children) {
    return (
      <span className={className} title={absolute}>
        {children(label)}
      </span>
    );
  }
  return (
    <time className={className} dateTime={valid ? instant.toISOString() : undefined} title={absolute}>
      {label}
    </time>
  );
}
