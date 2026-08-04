"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowRight, RefreshCw, TrendingDown, TrendingUp, Minus } from "lucide-react";
import type { ProductionJourney } from "@/brain/production-journey/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { VerdictStatusBadge } from "@/features/production-verdict/components/VerdictStatusBadge";
import { JourneyScoreChart } from "./JourneyScoreChart";
import { useI18n } from "@/lib/i18n/client";
import { trackEvent } from "@/lib/analytics/track";
import { useDemoNavigation } from "@/features/demo/use-demo-navigation";

function TrendIcon({ trend }: { trend: ProductionJourney["trend"] }) {
  if (trend === "improving") return <TrendingUp className="h-4 w-4 text-[#64D98B]" aria-hidden />;
  if (trend === "declining") return <TrendingDown className="h-4 w-4 text-[#FF5C6C]" aria-hidden />;
  return <Minus className="h-4 w-4 text-muted-foreground" aria-hidden />;
}

import { withAnalysisRunQuery } from "@/features/analysis-runs/lib/build-run-query";
import { projectVerdictHref } from "@/lib/navigation/project-hrefs";

export function ProductionJourneyView({
  journey,
  projectId,
  analysisRunLinksEnabled = false,
}: {
  journey: ProductionJourney;
  projectId: string;
  analysisRunLinksEnabled?: boolean;
}) {
  const { t } = useI18n("productionJourney");
  const { href } = useDemoNavigation();

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.pathname.startsWith("/demo")) return;
    trackEvent("production_journey_viewed", { projectId, validReviews: journey.validReviews });
  }, [journey.validReviews, projectId]);

  if (journey.validReviews === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center space-y-4">
          <p className="text-sm text-muted-foreground">{t("emptyTitle")}</p>
          <Button asChild>
            <Link href={href(projectVerdictHref(projectId))}>{t("emptyCta")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const latest = journey.timeline[journey.timeline.length - 1];
  const delta = latest?.scoreDelta ?? null;
  const deltaNarrative =
    delta != null && delta > 0
      ? t("scoreImprovedSince", { points: Math.abs(delta) })
      : delta != null && delta < 0
        ? t("scoreDeclinedSince", { points: Math.abs(delta) })
        : null;

  return (
    <div className="space-y-8">
      {journey.skippedInvalidVerdicts > 0 && (
        <p className="text-xs text-muted-foreground" role="status">
          {t("partialData")}
        </p>
      )}

      <Card className="border-primary/20 bg-gradient-to-b from-primary/5 to-transparent">
        <CardHeader>
          <CardTitle className="text-xl">{t("summaryTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">{t("currentScore")}</p>
            <p className="text-3xl font-bold">{journey.currentScore ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("previousScore")}</p>
            <p className="text-2xl font-semibold">{journey.previousScore ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("bestScore")}</p>
            <p className="text-2xl font-semibold">{journey.bestScore ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("trend")}</p>
            <p className="flex items-center gap-2 text-sm font-medium mt-1">
              <TrendIcon trend={journey.trend} />
              {t(`trendValues.${journey.trend}`)}
            </p>
          </div>
          {journey.currentStatus && (
            <div>
              <p className="text-xs text-muted-foreground">{t("currentVerdict")}</p>
              <VerdictStatusBadge status={journey.currentStatus} className="mt-1" />
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground">{t("maturity")}</p>
            <p className="text-sm font-medium mt-1">{t(`maturityValues.${journey.maturity}`)}</p>
          </div>
          {journey.currentFocusKey && (
            <div>
              <p className="text-xs text-muted-foreground">{t("currentFocus")}</p>
              <p className="text-sm font-medium mt-1">{t(journey.currentFocusKey)}</p>
            </div>
          )}
        </CardContent>
        {deltaNarrative && (
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground">{deltaNarrative}</p>
          </CardContent>
        )}
      </Card>

      <JourneyScoreChart timeline={journey.timeline} />

      {latest && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("latestChange")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {delta != null && (
              <p>
                {delta > 0
                  ? t("scoreIncreased", { points: delta })
                  : delta < 0
                    ? t("scoreDecreased", { points: Math.abs(delta) })
                    : null}
              </p>
            )}
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                {t("resolvedLabel")}
              </p>
              {journey.latestResolvedTitles.length > 0 ? (
                <ul className="list-disc pl-5 space-y-1">
                  {journey.latestResolvedTitles.map((title) => (
                    <li key={title}>{title}</li>
                  ))}
                </ul>
              ) : latest.resolvedBlockersCount > 0 ? (
                <p>{latest.resolvedBlockersCount} resolved</p>
              ) : (
                <p className="text-muted-foreground">—</p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                {t("introducedLabel")}
              </p>
              {journey.latestIntroducedTitles.length > 0 ? (
                <ul className="list-disc pl-5 space-y-1">
                  {journey.latestIntroducedTitles.map((title) => (
                    <li key={title}>{title}</li>
                  ))}
                </ul>
              ) : latest.introducedBlockersCount === 0 ? (
                <p className="text-muted-foreground">{t("noNewBlockers")}</p>
              ) : (
                <p>{latest.introducedBlockersCount} introduced</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {journey.milestones.length > 0 && (
        <section aria-labelledby="milestones-heading" className="space-y-3">
          <h2 id="milestones-heading" className="text-lg font-semibold">
            {t("milestonesTitle")}
          </h2>
          <ol className="space-y-3 border-l border-border/60 pl-4">
            {journey.milestones.map((milestone) => (
              <li key={milestone.id} className="relative pl-4">
                <span className="absolute -left-[5px] top-2 h-2 w-2 rounded-full bg-primary" aria-hidden />
                <p className="font-medium text-sm">{t(milestone.titleKey)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {milestone.score != null ? `Score: ${milestone.score}` : ""}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("blockersTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">{t("blockersResolved")}</p>
            <p className="text-2xl font-semibold">{journey.blockersResolved}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("blockersIntroduced")}</p>
            <p className="text-2xl font-semibold">{journey.blockersIntroduced}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("netImprovement")}</p>
            <p className="text-2xl font-semibold">{journey.netBlockerImprovement}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("currentBlockers")}</p>
            <p className="text-2xl font-semibold">{journey.currentBlockers}</p>
          </div>
        </CardContent>
      </Card>

      {journey.areasProgress.length > 0 && (
        <section aria-labelledby="areas-heading" className="space-y-3">
          <h2 id="areas-heading" className="text-lg font-semibold">
            {t("areasProgress")}
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {journey.areasProgress.map((area) => (
              <li
                key={area.key}
                className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-sm"
              >
                <p className="font-medium">{area.label}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {area.status === "evaluated" && area.currentScore != null
                    ? `${area.previousScore ?? "—"} → ${area.currentScore}`
                    : area.status === "partial"
                      ? t("areaStatus.partial")
                      : t("areaStatus.not_evaluated")}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="history-heading" className="space-y-3">
        <h2 id="history-heading" className="text-lg font-semibold">
          {t("reviewHistory")}
        </h2>
        <ul className="space-y-2">
          {[...journey.timeline].reverse().slice(0, 20).map((point) => (
            <li
              key={point.verdictId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 text-sm"
            >
              <div className="space-y-0.5">
                <p className="font-medium">
                  {point.score != null ? `${point.score}/100` : "—"}{" "}
                  {point.scoreDelta != null && (
                    <Badge variant="outline" className="text-xs ml-1">
                      {point.scoreDelta > 0 ? "+" : ""}
                      {point.scoreDelta}
                    </Badge>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {point.commitSha ? point.commitSha.slice(0, 12) : "—"}
                  {point.branch ? ` · ${point.branch}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <VerdictStatusBadge status={point.status} />
                {analysisRunLinksEnabled ? (
                  <Button variant="ghost" size="sm" asChild>
                    <Link
                      href={withAnalysisRunQuery(
                        href(`/projects/${projectId}/mission-control`),
                        point.scanId
                      )}
                      onClick={() =>
                        trackEvent("review_history_opened", {
                          scanId: point.scanId,
                          destination: "mission_control",
                        })
                      }
                    >
                      {t("viewRun")}
                    </Link>
                  </Button>
                ) : null}
                <Button variant="ghost" size="sm" asChild>
                  <Link
                    href={href(`/projects/${projectId}/scans/${point.scanId}/report`)}
                    onClick={() => trackEvent("review_history_opened", { scanId: point.scanId })}
                  >
                    {t("openReport")}
                    <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function ProductionJourneyError({ onRetry }: { onRetry?: () => void }) {
  const { t } = useI18n("productionJourney");
  const { t: tc } = useI18n("common");
  return (
    <Card className="border-destructive/30">
      <CardContent className="py-10 text-center space-y-3">
        <p className="text-sm">{t("loadFailed")}</p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {tc("retry")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
