"use client";

import type { VerdictExperienceView } from "@/brain/production-verdict/experience-view";
import { useI18n } from "@/lib/i18n/client";

export function ProjectedScorePanel({ view }: { view: VerdictExperienceView }) {
  const { t } = useI18n("verdict");

  if (!view.showScore || view.score == null || view.projectedScore == null) return null;

  const improvement = view.scoreImprovement ?? 0;

  return (
    <section
      className="rounded-xl border border-border/60 bg-surface/80 p-5"
      aria-label={t("projectedScore")}
    >
      <h3 className="text-sm font-medium">{t("scoreProjectionTitle")}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{t("scoreProjectionSubtitle")}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-muted-foreground">{t("currentScore")}</p>
          <p className="text-3xl font-semibold tabular-nums">{view.score}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t("projectedAfterPriorities")}</p>
          <p className="text-3xl font-semibold tabular-nums text-success">
            {view.projectedScore}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t("improvement")}</p>
          <p className="text-3xl font-semibold tabular-nums">
            {improvement > 0 ? "+" : ""}
            {improvement}
          </p>
        </div>
      </div>
      {view.projectedScoreIsEstimate && (
        <p className="mt-3 text-xs text-muted-foreground">{t("projectionEstimate")}</p>
      )}
    </section>
  );
}
