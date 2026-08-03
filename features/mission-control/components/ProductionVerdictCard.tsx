"use client";

import { useI18n } from "@/lib/i18n/client";
import type { MissionVerdictCard } from "../types";

function toneClass(verdictStatus: MissionVerdictCard["verdictStatus"]): string {
  switch (verdictStatus) {
    case "ready_to_ship":
      return "border-emerald-500/30 bg-emerald-500/5";
    case "almost_ready":
      return "border-amber-500/30 bg-amber-500/5";
    case "insufficient_data":
    case "analysis_failed":
      return "border-border/60 bg-[#101014]/50";
    default:
      return "border-red-500/30 bg-red-500/5";
  }
}

export function ProductionVerdictCardSection({ verdict }: { verdict: MissionVerdictCard }) {
  const { t } = useI18n("missionControl");

  return (
    <section
      className={`rounded-3xl border p-8 sm:p-10 space-y-8 ${toneClass(verdict.verdictStatus)}`}
      aria-labelledby="production-verdict-heading"
    >
      <div>
        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground mb-3">{t("verdict.title")}</p>
        <h2 id="production-verdict-heading" className="text-3xl sm:text-4xl font-semibold tracking-tight">
          {verdict.display}
        </h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 text-sm">
        <Metric label={t("verdict.confidence")} value={verdict.confidence} />
        <Metric label={t("verdict.criticalCampaigns")} value={String(verdict.criticalCampaigns)} />
        <Metric label={t("verdict.replay")} value={verdict.replayStatusLabel} />
        <Metric label={t("verdict.engineeringPlan")} value={verdict.engineeringPlanStatusLabel} />
        <Metric label={t("verdict.score")} value={String(verdict.score)} />
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
        {verdict.deploymentRecommendation}
      </p>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium capitalize">{value}</p>
    </div>
  );
}
