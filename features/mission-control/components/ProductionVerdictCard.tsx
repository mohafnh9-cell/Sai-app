"use client";

import { useI18n } from "@/lib/i18n/client";
import { IntelligenceSurface } from "@/components/sequrai";
import { verdictSurfaceClass } from "@/lib/design-system/verdict";
import type { MissionVerdictCard } from "../types";
import { typography } from "@/lib/design-system/tokens";

export function ProductionVerdictCardSection({ verdict }: { verdict: MissionVerdictCard }) {
  const { t } = useI18n("missionControl");

  return (
    <IntelligenceSurface
      toneClass={verdictSurfaceClass(verdict.verdictStatus)}
      aria-labelledby="production-verdict-heading"
    >
      <div>
        <p className={`${typography.eyebrow} mb-3`}>{t("verdict.title")}</p>
        <h2 id="production-verdict-heading" className="text-display-headline">
          {verdict.display}
        </h2>
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 text-sm">
        <Metric label={t("verdict.confidence")} value={verdict.confidence} />
        <Metric label={t("verdict.criticalCampaigns")} value={String(verdict.criticalCampaigns)} />
        <Metric label={t("verdict.replay")} value={verdict.replayStatusLabel} />
        <Metric label={t("verdict.engineeringPlan")} value={verdict.engineeringPlanStatusLabel} />
        <Metric label={t("verdict.score")} value={verdict.score == null ? "—" : String(verdict.score)} />
      </div>
      <p className="mt-6 text-sm text-muted-foreground leading-relaxed max-w-2xl">
        {verdict.deploymentRecommendation}
      </p>
    </IntelligenceSurface>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-label-caps">{label}</p>
      <p className="mt-1 font-medium capitalize">{value}</p>
    </div>
  );
}
