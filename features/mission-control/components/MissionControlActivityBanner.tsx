"use client";

import { Loader2, ScanSearch, Swords } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/lib/i18n/client";
import { translateStoredProgressMessage } from "@/lib/i18n/review-progress";

export type MissionControlActivityKind = "scan" | "attack";

export function MissionControlActivityBanner({
  kind,
  progress,
  progressMessage,
}: {
  kind: MissionControlActivityKind;
  progress?: number | null;
  progressMessage?: string | null;
}) {
  const { t, locale } = useI18n("missionControl");
  const isScan = kind === "scan";
  const Icon = isScan ? ScanSearch : Swords;
  const title = isScan ? t("activity.scan.title") : t("activity.attack.title");
  const subtitle = isScan ? t("activity.scan.subtitle") : t("activity.attack.subtitle");
  const barValue = Math.max(12, Math.min(100, progress ?? 24));

  const detail = isScan
    ? progressMessage
      ? translateStoredProgressMessage(locale, progressMessage)
      : progress != null
        ? `${progress}%`
        : t("activity.scan.detail")
    : t("activity.attack.detail");

  return (
    <div
      className="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-primary/10 via-primary/5 to-transparent p-6 sm:p-8 shadow-[0_0_60px_-24px_rgba(var(--primary-rgb,99,102,241),0.45)]"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(var(--primary-rgb,99,102,241),0.14),transparent_55%)]"
        aria-hidden
      />
      <div className="relative flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15">
          <Icon className="h-6 w-6 text-primary animate-pulse" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 space-y-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" aria-hidden />
              <p className="text-base font-semibold tracking-tight">{title}</p>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{subtitle}</p>
          </div>
          <div className="space-y-2">
            <Progress value={barValue} aria-label={title} />
            <p className="text-xs text-muted-foreground animate-pulse">{detail}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
