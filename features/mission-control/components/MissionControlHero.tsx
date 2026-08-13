"use client";

import { verdictExperienceFromVerdict } from "@/brain/production-verdict/experience-view";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { shouldShowScore, verdictToneClass } from "@/brain/production-verdict/status-ui";
import { VerdictStatusBadge } from "@/features/production-verdict/components/VerdictStatusBadge";
import { useI18n } from "@/lib/i18n/client";
import { verdictStatusMessage } from "@/lib/i18n/verdict-copy";
import { formatPriorityTitleForLocale } from "@/lib/i18n/priority-display";

/**
 * Production Verdict hero — answers "Can I deploy?" with score and main blocker.
 */
export function MissionControlHero({ verdict }: { verdict: ProductionVerdictV1 }) {
  const { t, locale } = useI18n();
  const { t: tm } = useI18n("missionControl");
  const translate = (key: string, params?: Record<string, string | number | null | undefined>) =>
    t(key, params);

  const view = verdictExperienceFromVerdict(verdict, {
    statusMessage: verdictStatusMessage(verdict.status, translate),
  });

  const canDeployKey =
    view.status === "ready_to_ship"
      ? "verdict.canIDeploy.yes"
      : view.status === "almost_ready"
        ? "verdict.canIDeploy.almost"
        : view.status === "insufficient_data" || view.status === "analysis_failed"
          ? "verdict.canIDeploy.insufficient"
          : "verdict.canIDeploy.no";

  const tone = verdictToneClass(view.status);
  const topBlocker = verdict.topPriorities?.[0] ?? null;
  const showScore = shouldShowScore(verdict.score, verdict.status);

  return (
    <section
      id="production-verdict-detail"
      className={`rounded-3xl border p-8 sm:p-10 surface-premium ${tone}`}
      aria-labelledby="mission-control-verdict-heading"
    >
      <p className="text-sm uppercase tracking-[0.24em] text-muted-foreground">
        {t("verdict.productionVerdict")}
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-6">
        {showScore && verdict.score != null ? (
          <div>
            <p className="text-6xl sm:text-7xl font-semibold tabular-nums tracking-tighter leading-none">
              {verdict.score}
            </p>
            <p className="mt-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              {tm("projectHome.verdictSummary.score")}
            </p>
          </div>
        ) : null}
        <div className="space-y-3 pb-1">
          <p
            id="mission-control-verdict-heading"
            className="text-3xl sm:text-4xl font-semibold tracking-tight leading-none"
          >
            {t(canDeployKey)}
          </p>
          <VerdictStatusBadge status={view.status} />
        </div>
      </div>
      {topBlocker ? (
        <div className="mt-8 pt-6 border-t border-border/40 space-y-1">
          <p className="text-sm font-medium text-muted-foreground">
            {tm("projectHome.verdictSummary.mainBlocker")}
          </p>
          <p className="text-lg font-medium leading-snug">
            {formatPriorityTitleForLocale(topBlocker, locale)}
          </p>
          {topBlocker.reason ? (
            <p className="text-sm text-muted-foreground leading-relaxed">{topBlocker.reason}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
