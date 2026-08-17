"use client";

import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

export type SecurityTimelineEvent = {
  id: string;
  at: string;
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
};

type SecurityTimelineProps = {
  events: SecurityTimelineEvent[];
  className?: string;
};

const toneDot: Record<NonNullable<SecurityTimelineEvent["tone"]>, string> = {
  neutral: "bg-muted-foreground/50",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export function SecurityTimeline({ events, className }: SecurityTimelineProps) {
  const { locale } = useI18n();

  if (events.length === 0) return null;

  const formatTime = (at: string) => {
    const tag = locale === "es" ? "es-ES" : "en-US";
    return new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit" }).format(new Date(at));
  };

  return (
    <section className={cn("space-y-4", className)} aria-labelledby="security-timeline-heading">
      <h2 id="security-timeline-heading" className="text-sm font-semibold tracking-tight">
        Analysis timeline
      </h2>
      <ol className="relative space-y-0 border-l border-border/50 ml-2">
        {events.map((event, index) => {
          const tone = event.tone ?? "neutral";
          const time = formatTime(event.at);
          return (
            <li key={event.id} className="relative pl-6 pb-5 last:pb-0">
              <span
                className={cn(
                  "absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-background",
                  toneDot[tone]
                )}
                aria-hidden
              />
              <p className="text-xs text-muted-foreground tabular-nums">{time}</p>
              <p className={cn("text-sm mt-0.5", index === events.length - 1 && "font-medium")}>
                {event.label}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
