"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { formatLocalizedDate } from "@/lib/i18n/format";
import type { MissionControlView } from "../types";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import type { FixPromptContext } from "@/features/production-verdict/fix-prompt-context";
import type { SecurityTestContext } from "@/features/security-testing/types";
import type { ProjectReviewUiContext } from "@/server/projects/review-ui-context";
import { useSecurityTestContext } from "@/features/analysis-runs/hooks/useSecurityTestContext";
import { TERMINAL_DISPLAY_PHASES } from "@/features/security-testing/lib/derive-phase";
import { useI18n } from "@/lib/i18n/client";
import { AnalyzeApplicationPrompt } from "./production-readiness/AnalyzeApplicationPrompt";
import { DeploymentBlockersList } from "./production-readiness/DeploymentBlockersList";
import { MissionControlHero } from "./MissionControlHero";
import { MissionControlReason } from "./MissionControlReason";
import {
  MissionControlPrimaryAction,
  derivePrimaryActionKind,
} from "./MissionControlPrimaryAction";
import { SafeFixHeroCard } from "@/features/production-verdict/components/SafeFixHeroCard";
import { fixPromptInputFromPriority, findingsByIdMap } from "@/brain/fix-prompt";
import { MissionControlHistorySection } from "./MissionControlHistorySection";
import { MissionControlTechnicalDetails } from "./MissionControlTechnicalDetails";
import { MissionControlProtectionStatus } from "./MissionControlProtectionStatus";
import type { ProtectionCenterSnapshot } from "@/features/continuous-protection/types";

export function MissionControlExperience({
  view,
  verdict,
  projectName,
  framework,
  fixPromptContext,
  securityTestContext = null,
  reviewContext = null,
  analysisRunId = null,
  runScoped = false,
  analysisRunIsolationEnabled = false,
  reportHref,
  openTechnicalDetails = false,
  protectionCenter = null,
  showProtectionStatus = false,
  isVerdictStale = false,
}: {
  view: MissionControlView;
  verdict: ProductionVerdictV1 | null;
  projectName: string;
  framework?: string | null;
  fixPromptContext?: FixPromptContext;
  securityTestContext?: SecurityTestContext | null;
  reviewContext?: ProjectReviewUiContext | null;
  analysisRunId?: string | null;
  runScoped?: boolean;
  analysisRunIsolationEnabled?: boolean;
  reportHref?: string;
  openTechnicalDetails?: boolean;
  protectionCenter?: ProtectionCenterSnapshot | null;
  showProtectionStatus?: boolean;
  isVerdictStale?: boolean;
}) {
  const router = useRouter();
  const { t, locale } = useI18n("missionControl");
  const guidedFlowActive = Boolean(securityTestContext && reviewContext);

  const { data: liveSecurityTestContext } = useSecurityTestContext(view.projectId, {
    analysisRunId: runScoped ? analysisRunId : null,
    initialData: securityTestContext ?? undefined,
    enabled: runScoped && Boolean(securityTestContext),
  });

  const activeSecurityTestContext = runScoped
    ? (liveSecurityTestContext ?? securityTestContext)
    : securityTestContext;

  const phase = activeSecurityTestContext?.phase ?? "needs_review";
  const displayPhase =
    runScoped || !activeSecurityTestContext
      ? phase
      : phase === "preparing" && verdict
        ? "ready"
        : phase;

  const reviewInProgress = Boolean(
    reviewContext?.productionReviewState?.hasActiveReview ||
      activeSecurityTestContext?.reviewInProgress
  );

  useEffect(() => {
    if (runScoped || !guidedFlowActive) return;
    if (displayPhase === "ready") return;
    if (verdict && !reviewContext?.productionReviewState?.hasActiveReview) return;
    if (phase === "preparing" && verdict) return;
    const shouldPoll =
      activeSecurityTestContext?.reviewInProgress ||
      displayPhase === "preparing" ||
      displayPhase === "running" ||
      displayPhase === "issues_found" ||
      displayPhase === "fix_ready";
    if (!shouldPoll || TERMINAL_DISPLAY_PHASES.has(displayPhase)) return;
    const timer = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [
    activeSecurityTestContext?.reviewInProgress,
    displayPhase,
    guidedFlowActive,
    phase,
    reviewContext?.productionReviewState?.hasActiveReview,
    router,
    runScoped,
    verdict,
  ]);

  const primaryActionKind = derivePrimaryActionKind({
    verdict,
    displayPhase,
    reviewInProgress,
  });

  const topPriority = verdict?.topPriorities?.[0] ?? null;
  const safeFixPromptInput = useMemo(() => {
    if (!topPriority || !verdict || verdict.status === "ready_to_ship") return null;
    return fixPromptInputFromPriority(topPriority, {
      projectName,
      stack: fixPromptContext?.stack,
      findingsById: fixPromptContext?.findings
        ? findingsByIdMap(fixPromptContext.findings)
        : undefined,
      currentVerdictStatus: verdict.status,
      currentScore: verdict.score,
    });
  }, [fixPromptContext, projectName, topPriority, verdict]);

  const showSafeFixCard =
    primaryActionKind === "copy_safe_fix" && topPriority && safeFixPromptInput;

  const blockers = verdict?.topPriorities ?? [];
  const showBlockers = blockers.length > 0 && verdict?.status !== "ready_to_ship";

  const needsInitialReview =
    !verdict &&
    (displayPhase === "needs_review" ||
      displayPhase === "preparing" ||
      !guidedFlowActive);

  return (
    <div className="space-y-10 max-w-2xl mx-auto">
      {needsInitialReview && reviewContext ? (
        <AnalyzeApplicationPrompt
          projectId={view.projectId}
          reviewContext={reviewContext}
          preparing={displayPhase === "preparing" || reviewInProgress}
          waitMessage={
            reviewInProgress || displayPhase === "preparing"
              ? t("sections.reviewInProgress")
              : null
          }
          analysisRunIsolationEnabled={analysisRunIsolationEnabled}
        />
      ) : null}

      {verdict ? (
        <>
          <MissionControlHero verdict={verdict} />

          {showProtectionStatus && (
            <MissionControlProtectionStatus
              projectId={view.projectId}
              initialData={protectionCenter}
              enabled={showProtectionStatus}
            />
          )}

          <MissionControlReason
            verdict={verdict}
            displayPhase={displayPhase}
            reviewInProgress={reviewInProgress}
          />

          {showBlockers ? (
            <DeploymentBlockersList blockers={blockers} />
          ) : null}

          {showSafeFixCard ? (
            <SafeFixHeroCard
              topPriority={topPriority}
              fixPromptInput={safeFixPromptInput}
            />
          ) : null}

          <MissionControlPrimaryAction
            kind={showSafeFixCard ? "none" : primaryActionKind}
            verdict={verdict}
            projectId={view.projectId}
            projectName={projectName}
            fixPromptContext={fixPromptContext}
            reviewContext={reviewContext}
            reportHref={reportHref}
            attackCenterHref={activeSecurityTestContext?.attackCenterHref}
            analysisRunIsolationEnabled={analysisRunIsolationEnabled}
          />

          <MissionControlHistorySection
            projectId={view.projectId}
            analysisRunId={analysisRunId}
            lastReviewAt={protectionCenter?.lastCheckedAt ?? verdict.generatedAt}
            isVerdictStale={isVerdictStale}
          />

          <MissionControlTechnicalDetails
            view={view}
            verdict={verdict}
            framework={framework}
            reportHref={reportHref}
            openByDefault={openTechnicalDetails}
          />
        </>
      ) : null}

      {!verdict && !reviewContext && !needsInitialReview ? (
        <section
          className="rounded-3xl border border-dashed border-border/60 bg-card/30 px-8 py-16 text-center space-y-3"
          role="status"
          aria-labelledby="mission-control-empty-heading"
        >
          <h2 id="mission-control-empty-heading" className="text-lg font-semibold">
            {t("empty.noVerdictTitle")}
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">{t("empty.noVerdictBody")}</p>
        </section>
      ) : null}

      {view.cancelledReview ? (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{t("feed.reviewStopped")}</p>
          <p className="mt-1">{formatLocalizedDate(locale, view.cancelledReview.cancelledAt)}</p>
        </div>
      ) : null}
    </div>
  );
}
