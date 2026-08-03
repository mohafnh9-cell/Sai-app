"use client";

import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/lib/i18n/client";
import type { MissionHeaderState } from "../types";

export function MissionHeader({ header }: { header: MissionHeaderState }) {
  const { t } = useI18n("missionControl");

  return (
    <section className="surface-premium rounded-3xl p-8 sm:p-10 space-y-8" aria-labelledby="mission-header-title">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">{t("header.mission")}</p>
        <h1 id="mission-header-title" className="text-2xl sm:text-3xl font-semibold tracking-tight">
          {header.missionTitle}
        </h1>
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-wider">{t("header.project")}</p>
          <p className="mt-1 font-medium">{header.projectName}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-wider">{t("header.status")}</p>
          <p className="mt-1 font-medium">{header.statusLabel}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-wider">{t("header.eta")}</p>
          <p className="mt-1 font-medium tabular-nums">{header.etaLabel}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-wider">{t("header.currentPhase")}</p>
          <p className="mt-1 font-medium">{header.currentPhase}</p>
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{t("header.progress")}</span>
          <span className="tabular-nums">{header.progressPercent}%</span>
        </div>
        <Progress value={header.progressPercent} className="h-1.5" />
      </div>
    </section>
  );
}
