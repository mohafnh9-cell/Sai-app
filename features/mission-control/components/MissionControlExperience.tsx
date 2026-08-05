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
import { DeploymentBlockersList } from "./production-readiness/DeploymentBlockersList";
import { ProjectHomeActions } from "./ProjectHomeActions";
import { MissionControlHero } from "./MissionControlHero";
import {
  MissionControlPrimaryAction,
  derivePrimaryActionKind,
} from "./MissionControlPrimaryAction";
import { SafeFixHeroCard } from "@/features/production-verdict/components/SafeFixHeroCard";
import { fixPromptInputFromPriority, findingsByIdMap } from "@/brain/fix-prompt";
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
  attackCenterEnabled = false,
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
  attackCenterEnabled?: boolean;
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

  return (
    <div className="space-y-10 max-w-2xl mx-auto">
      <ProjectHomeActions
        projectId={view.projectId}
        reviewContext={reviewContext}
        verdict={verdict}
        analysisRunId={analysisRunId}
        attackCenterEnabled={attackCenterEnabled}
        attackCenterHref={activeSecurityTestContext?.attackCenterHref}
        analysisRunIsolationEnabled={analysisRunIsolationEnabled}
      />

      {reviewInProgress && !verdict && reviewContext ? (
        <div
          className="rounded-2xl border border-border/60 bg-muted/20 px-5 py-4 text-sm text-muted-foreground text-center"
          role="status"
        >
          {t("sections.reviewInProgress")}
        </div>
      ) : null}

      {verdict ? (
        <>
          <MissionControlHero verdict={verdict} />

          {showBlockers ? (
            <DeploymentBlockersList blockers={blockers} />
          ) : null}

          {showSafeFixCard ? (
            <SafeFixHeroCard
              topPriority={topPriority}
              fixPromptInput={safeFixPromptInput}
              labels={{
                eyebrow: t("projectHome.aiFix.title"),
                copyLabel: t("projectHome.aiFix.openInCursor"),
              }}
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

          {showProtectionStatus && (
            <MissionControlProtectionStatus
              projectId={view.projectId}
              initialData={protectionCenter}
              enabled={showProtectionStatus}
            />
          )}

          <MissionControlTechnicalDetails
            view={view}
            verdict={verdict}
            framework={framework}
            reportHref={reportHref}
            openByDefault={openTechnicalDetails}
          />
        </>
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
