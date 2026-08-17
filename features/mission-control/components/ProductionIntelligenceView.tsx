"use client";

import Link from "next/link";
import type { ProductionIntelligence } from "@/brain/production-intelligence/schema";
import type { AreaProgress } from "@/brain/production-journey/schema";
import type { MissionControlState } from "@/features/mission-control/types/mission-control-state";
import {
  ProductionJourneyStrip,
  RepositoryHealth,
  SecurityTimeline,
  TopRisksList,
  WhatChangedSection,
} from "@/components/sequrai";
import { MissionControlHero } from "./MissionControlHero";
import { MissionControlTechnicalDetails } from "./MissionControlTechnicalDetails";
import { MissionControlActivityBanner } from "./MissionControlActivityBanner";
import { SafeFixHeroCard } from "@/features/production-verdict/components/SafeFixHeroCard";
import { fixPromptInputFromPriority, findingsByIdMap } from "@/brain/fix-prompt";
import { buildSecurityTimelineEvents } from "../lib/build-security-timeline";
import { formatRelativeLocalized } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/client";
import { verdictStatusHeadline } from "@/lib/i18n/verdict-copy";

type ProductionIntelligenceViewProps = {
  state: MissionControlState;
  intelligence: ProductionIntelligence | null;
  areasProgress: AreaProgress[];
  showScanActivity: boolean;
  showAttackActivity: boolean;
  staleVerdictWhileBusy: boolean;
  showSafeFixCard: boolean;
  safeFixPromptInput: ReturnType<typeof fixPromptInputFromPriority> | null;
  topPriority: NonNullable<MissionControlState["productionVerdict"]>["topPriorities"][0] | null;
  openFullReport: boolean;
};

export function ProductionIntelligenceView({
  state,
  intelligence,
  areasProgress,
  showScanActivity,
  showAttackActivity,
  staleVerdictWhileBusy,
  showSafeFixCard,
  safeFixPromptInput,
  topPriority,
  openFullReport,
}: ProductionIntelligenceViewProps) {
  const { t, locale } = useI18n("missionControl");
  const { t: tp } = useI18n("projects");
  const { t: tc } = useI18n("common");
  const { t: tAll } = useI18n();
  const verdict = state.productionVerdict;

  if (!verdict) return null;

  const findings = state.ui.fixPromptContext?.findings ?? [];
  const findingsMap = findingsByIdMap(findings);
  const timelineEvents = buildSecurityTimelineEvents(state, {
    analysisRun: (status) => {
      const statusKey = `analysisRun.runStatus.${status}`;
      const knownStatuses = new Set([
        "completed",
        "running",
        "failed",
        "queued",
        "cancelled",
        "unknown",
      ]);
      if (knownStatuses.has(status)) {
        return t(statusKey as "analysisRun.runStatus.completed");
      }
      return t("timeline.analysisRunStarted");
    },
    repositoryAnalyzed: t("timeline.repositoryAnalyzed"),
    findingsDetected: (count) => t("timeline.findingsDetected", { count }),
    risksIntroduced: (count) => t("timeline.risksIntroduced", { count }),
    verdictUpdated: (headline) => t("timeline.verdictUpdated", { headline }),
    verdictHeadline: (status) => verdictStatusHeadline(status, tAll),
  }, intelligence);
  const lastAnalysis = state.status.lastAnalysisAt
    ? formatRelativeLocalized(locale, state.status.lastAnalysisAt, {
        never: tc("never"),
        justNow: tc("justNow"),
        minutesAgo: tc("minutesAgo"),
        hoursAgo: tc("hoursAgo"),
        daysAgo: tc("daysAgo"),
      })
    : tc("never");

  return (
    <div
      className={
        staleVerdictWhileBusy ? "space-y-12 opacity-60 pointer-events-none" : "space-y-12"
      }
    >
      {staleVerdictWhileBusy ? (
        <p className="text-sm text-muted-foreground text-center" role="status">
          {showAttackActivity ? t("activity.staleVerdictAttack") : t("activity.staleVerdictScan")}
        </p>
      ) : null}

      <header className="space-y-3 product-section">
        <p className="text-eyebrow">{t("productionIntelligence.eyebrow")}</p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{state.projectName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("productionIntelligence.latestAnalysis")} · {lastAnalysis}
              {state.status.currentCommitSha ? (
                <span className="ml-2 font-mono text-xs">{state.status.currentCommitSha.slice(0, 7)}</span>
              ) : null}
            </p>
          </div>
          <ProductionJourneyStrip activeStep={showScanActivity ? "analysis" : "verdict"} />
        </div>
      </header>

      {(showScanActivity || showAttackActivity) && (
        <MissionControlActivityBanner
          kind={showAttackActivity ? "attack" : "scan"}
          progress={state.status.progress}
          progressMessage={state.status.progressMessage}
        />
      )}

      <MissionControlHero verdict={verdict} showViewReportLink={state.status.hasCompletedAnalysis} />

      {intelligence ? (
        <WhatChangedSection
          items={[...intelligence.improvements, ...intelligence.regressions]}
          hasChanges={intelligence.whatChanged.hasChanges}
        />
      ) : null}

      <TopRisksList
        blockers={verdict.topPriorities ?? []}
        findingsById={findingsMap}
        onSelect={() => {
          document.getElementById("mission-control-full-report")?.scrollIntoView({ behavior: "smooth" });
        }}
      />

      {showSafeFixCard && topPriority && safeFixPromptInput ? (
        <section className="space-y-2 product-section">
          <SafeFixHeroCard
            topPriority={topPriority}
            fixPromptInput={safeFixPromptInput}
            labels={{
              eyebrow: t("projectHome.aiFix.title"),
              copyLabel: t("projectHome.aiFix.openInCursor"),
            }}
          />
          <p className="text-xs text-muted-foreground">{tp("safeFixMcpHint")}</p>
        </section>
      ) : null}

      <RepositoryHealth areas={areasProgress} />

      <SecurityTimeline events={timelineEvents} />

      <MissionControlTechnicalDetails
        view={state.view}
        verdict={verdict}
        framework={state.framework}
        findings={findings}
        fixPromptContext={state.ui.fixPromptContext}
        projectId={state.projectId}
        openByDefault={openFullReport}
      />

      {state.status.hasCompletedAnalysis ? (
        <div className="pt-2">
          <Link
            href="#mission-control-full-report"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline seq-focus-ring rounded-sm"
          >
            {t("fullReport.viewLink")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
