"use client";

import { verdictExperienceFromVerdict } from "@/brain/production-verdict/experience-view";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { ProductionVerdictCard } from "@/components/sequrai";
import { ScoreDeltaSummary } from "@/features/production-verdict/components/ScoreDeltaSummary";
import { useI18n } from "@/lib/i18n/client";
import { verdictStatusMessage } from "@/lib/i18n/verdict-copy";
import { formatPriorityTitleForLocale } from "@/lib/i18n/priority-display";

/**
 * Production Verdict hero — answers "Can I deploy?" with score and main blocker.
 */
export function MissionControlHero({
  verdict,
  showViewReportLink = false,
  resolvedSinceLastScan = 0,
  scanSource,
}: {
  verdict: ProductionVerdictV1;
  showViewReportLink?: boolean;
  /** Real count from the backend finding-resolution diff — never estimated. */
  resolvedSinceLastScan?: number;
  /** "github" | "upload" — how the scan behind this verdict was ingested. Defaults to github. */
  scanSource?: string;
}) {
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

  const topBlocker = verdict.topPriorities?.[0] ?? null;
  const why =
    view.blockersCount > 0
      ? t("verdict.blockersRequireAttention", { count: view.blockersCount }) +
        (resolvedSinceLastScan > 0
          ? t("verdict.resolvedSinceLastScanInline", { count: resolvedSinceLastScan })
          : "")
      : null;

  return (
    <ProductionVerdictCard
      id="production-verdict-detail"
      headingId="mission-control-verdict-heading"
      eyebrow={t("verdict.productionVerdict")}
      headline={t(canDeployKey)}
      status={view.status}
      score={verdict.score}
      scoreLabel={tm("projectHome.verdictSummary.score")}
      why={why}
      sourceBadge={
        <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/30 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          {scanSource === "upload"
            ? tm("verdictSource.upload")
            : scanSource === "local"
              ? tm("verdictSource.local")
              : tm("verdictSource.github")}
        </span>
      }
      blocker={
        topBlocker
          ? {
              eyebrow: tm("projectHome.verdictSummary.mainBlocker"),
              title: formatPriorityTitleForLocale(topBlocker, locale),
              description: topBlocker.reason,
            }
          : null
      }
      footerLink={
        showViewReportLink
          ? { href: "#mission-control-full-report", label: tm("fullReport.viewLink") }
          : null
      }
    >
      {view.scoreDelta != null ? (
        <div className="mt-4">
          <ScoreDeltaSummary view={view} />
        </div>
      ) : null}
    </ProductionVerdictCard>
  );
}
