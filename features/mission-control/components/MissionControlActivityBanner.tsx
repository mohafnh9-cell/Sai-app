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
      className="rounded-xl border border-border/60 bg-muted/20 p-5 sm:p-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-5 w-5 text-primary" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" aria-hidden />
              <p className="text-sm font-semibold tracking-tight">{title}</p>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{subtitle}</p>
          </div>
          <div className="space-y-2">
            <Progress value={barValue} aria-label={title} className="h-1" />
            <p className="text-xs text-muted-foreground">{detail}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
