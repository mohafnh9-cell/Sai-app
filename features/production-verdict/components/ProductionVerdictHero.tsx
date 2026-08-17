"use client";

import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VerdictStatusBadge } from "./VerdictStatusBadge";
import { ProductionScoreDisplay } from "./ProductionScoreDisplay";
import { ReadyToShipMoment } from "./ReadyToShipMoment";
import { verdictToneClass } from "@/brain/production-verdict/status-ui";
import type { VerdictExperienceView } from "@/brain/production-verdict/experience-view";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { useI18n } from "@/lib/i18n/client";
import {
  verdictStatusHeadline,
  verdictStatusMessage,
} from "@/lib/i18n/verdict-copy";

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="min-w-[120px]">
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

export function ProductionVerdictHero({
  verdict,
  view,
  reportHref,
  retryHref,
  variant = "default",
}: {
  verdict: ProductionVerdictV1;
  view: VerdictExperienceView;
  reportHref?: string;
  retryHref?: string;
  variant?: "default" | "product";
}) {
  const { t } = useI18n();
  const translate = (key: string, params?: Record<string, string | number | null | undefined>) =>
    t(key, params);

  if (view.showReadyMoment) {
    return <ReadyToShipMoment view={view} verdict={verdict} reportHref={reportHref} />;
  }

  const tone = verdictToneClass(view.status);

  if (variant === "product") {
    const canDeployKey =
      view.status === "ready_to_ship"
        ? "verdict.canIDeploy.yes"
        : view.status === "almost_ready"
          ? "verdict.canIDeploy.almost"
          : "verdict.canIDeploy.no";

    return (
      <section className={`rounded-3xl border p-8 sm:p-10 surface-premium ${tone}`}>
        <div className="space-y-8 max-w-3xl">
          <div className="space-y-3">
            <p className="text-sm uppercase tracking-[0.24em] text-muted-foreground">
              {t("verdict.canIDeploy.question")}
            </p>
            <p className="text-5xl sm:text-6xl font-semibold tracking-tighter leading-none">
              {t(canDeployKey)}
            </p>
          </div>
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <VerdictStatusBadge status={view.status} />
            <ProductionScoreDisplay score={view.score} status={view.status} size="lg" />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`rounded-2xl border p-6 md:p-8 ${tone}`}
      aria-labelledby="production-verdict-hero-heading"
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-4 max-w-2xl">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            {t("verdict.productionVerdict")}
          </p>
          <div className="space-y-2">
            <h2
              id="production-verdict-hero-heading"
              className="text-2xl md:text-3xl font-semibold tracking-tight uppercase"
            >
              {verdictStatusHeadline(view.status, translate)}
            </h2>
            <VerdictStatusBadge status={view.status} />
          </div>
          <p className="text-base text-foreground/90 leading-relaxed">
            {verdictStatusMessage(view.status, translate)}
          </p>
          {view.status === "insufficient_data" && (
            <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
              {verdict.filesAnalyzed < 10 && <li>{t("verdict.insufficientFiles")}</li>}
              {verdict.coverageRatio != null && verdict.coverageRatio < 0.3 && (
                <li>{t("verdict.partialCoverage")}</li>
              )}
              <li>{view.recommendedAction}</li>
            </ul>
          )}
          {view.status === "analysis_failed" && (
            <div className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm space-y-3">
              <p className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-danger shrink-0 mt-0.5" aria-hidden />
                {view.executiveSummary || t("verdict.analysisFailedFallback")}
              </p>
              {retryHref && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={retryHref}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {t("verdict.retryProductionCheck")}
                  </Link>
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 lg:text-right">
          <ProductionScoreDisplay score={view.score} status={view.status} size="lg" />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-6 border-t border-border/50 pt-6">
        <Metric
          label={t("verdict.productionBlocker", { count: view.blockersCount })}
          value={view.blockersCount}
        />
        {view.showScore && view.estimatedFixMinutes > 0 && (
          <Metric
            label={t("verdict.estimatedPathForward")}
            value={`${view.estimatedFixMinutes} ${t("verdict.minutesUnit")}`}
          />
        )}
        {view.showScore && view.projectedScore != null && (
          <Metric
            label={t("verdict.projectedScore")}
            value={`${view.projectedScore} / 100`}
            sub={t("verdict.afterPriorities")}
          />
        )}
        {view.scoreDelta != null && view.scoreDelta !== 0 && (
          <Metric
            label={t("verdict.scoreDelta")}
            value={`${view.scoreDelta > 0 ? "+" : ""}${view.scoreDelta}`}
            sub={t("verdict.sincePreviousReview")}
          />
        )}
      </div>

      {reportHref && view.status !== "analysis_failed" && (
        <div className="mt-6">
          <Button variant="outline" size="sm" asChild>
            <Link href={reportHref}>{t("verdict.viewTechnicalReport")}</Link>
          </Button>
        </div>
      )}
    </section>
  );
}
