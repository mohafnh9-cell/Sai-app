"use client";

import { journeyMaturityKey } from "@/brain/production-journey/decision-display";
import Link from "next/link";
import { ArrowRight, TrendingDown, TrendingUp, Minus } from "lucide-react";
import type { ProductionJourneyPreview } from "@/brain/production-journey/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JourneyScoreChart } from "./JourneyScoreChart";
import { useI18n } from "@/lib/i18n/client";
import type { ProductionJourneyPoint } from "@/brain/production-journey/schema";

function miniTimelineFromPreview(preview: ProductionJourneyPreview): ProductionJourneyPoint[] {
  if (preview.currentScore === null) return [];
  return [
    {
      verdictId: "00000000-0000-0000-0000-000000000001",
      scanId: "00000000-0000-0000-0000-000000000002",
      commitSha: null,
      branch: null,
      score: preview.previousScore,
      status: "needs_improvement",
      scoreDelta: null,
      blockersCount: 0,
      introducedBlockersCount: 0,
      resolvedBlockersCount: 0,
      generatedAt: new Date(Date.now() - 86400000).toISOString(),
      isValidForScoreChart: preview.previousScore !== null,
    },
    {
      verdictId: "00000000-0000-0000-0000-000000000003",
      scanId: "00000000-0000-0000-0000-000000000004",
      commitSha: null,
      branch: null,
      score: preview.currentScore,
      status: "almost_ready",
      scoreDelta: preview.latestScoreDelta,
      blockersCount: 0,
      introducedBlockersCount: 0,
      resolvedBlockersCount: 0,
      generatedAt: new Date().toISOString(),
      isValidForScoreChart: true,
    },
  ].filter((p) => p.isValidForScoreChart && p.score !== null) as ProductionJourneyPoint[];
}

export function ProductionJourneyPreviewCard({
  projectId,
  preview,
  timeline,
  reviewInProgress = false,
}: {
  projectId: string;
  preview: ProductionJourneyPreview;
  timeline?: ProductionJourneyPoint[];
  reviewInProgress?: boolean;
}) {
  const { t } = useI18n("productionJourney");

  if (preview.validReviews === 0) return null;

  const chartTimeline =
    timeline && timeline.length >= 2
      ? timeline
      : miniTimelineFromPreview(preview);

  const TrendIcon =
    preview.trend === "improving"
      ? TrendingUp
      : preview.trend === "declining"
        ? TrendingDown
        : Minus;

  return (
    <Card className="border-border/50">
      <CardHeader className="flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">{t("previewTitle")}</CardTitle>
        <Button variant="ghost" size="sm" asChild>
          <Link
            href={`/projects/${projectId}/journey`}
            onClick={() => {
              import("@/lib/analytics/track").then(({ trackEvent }) =>
                trackEvent("production_journey_cta_clicked", { projectId })
              );
            }}
          >
            {t("viewJourney")}
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">{t("currentScore")}</p>
            <p className="text-xl font-bold">{preview.currentScore ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("bestScore")}</p>
            <p className="font-semibold">{preview.bestScore ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("trend")}</p>
            <p className="flex items-center gap-1 font-medium">
              <TrendIcon className="h-3.5 w-3.5" aria-hidden />
              {t(`trendValues.${preview.trend}`)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("maturity")}</p>
            <p>{t(`maturityValues.${journeyMaturityKey(preview, reviewInProgress)}`)}</p>
          </div>
        </div>
        {chartTimeline.length >= 2 && <JourneyScoreChart timeline={chartTimeline} />}
        {preview.latestScoreDelta != null && preview.latestScoreDelta !== 0 && (
          <p className="text-xs text-muted-foreground">
            {preview.latestScoreDelta > 0
              ? t("scoreIncreased", { points: preview.latestScoreDelta })
              : t("scoreDecreased", { points: Math.abs(preview.latestScoreDelta) })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
