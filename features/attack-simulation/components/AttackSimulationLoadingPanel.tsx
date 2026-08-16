"use client";

import { Loader2, Swords } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/lib/i18n/client";

export function AttackSimulationLoadingPanel({
  title,
  subtitle,
  progress = 32,
}: {
  title?: string;
  subtitle?: string;
  progress?: number;
}) {
  const { t } = useI18n("attackCenter");
  const barValue = Math.max(12, Math.min(100, progress));

  return (
    <div
      className="relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-b from-primary/10 via-primary/5 to-transparent p-8 sm:p-10"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="relative flex flex-col items-center text-center gap-5 max-w-md mx-auto">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
          <Swords className="h-7 w-7 text-primary animate-pulse" aria-hidden />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
            <p className="text-base font-semibold">{title ?? t("loadingPanel.title")}</p>
          </div>
          <p className="text-sm text-muted-foreground">{subtitle ?? t("loadingPanel.subtitle")}</p>
        </div>
        <Progress value={barValue} className="w-full max-w-xs" aria-label={title ?? t("loadingPanel.title")} />
      </div>
    </div>
  );
}
