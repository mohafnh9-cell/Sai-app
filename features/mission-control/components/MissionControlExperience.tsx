"use client";

import { Suspense } from "react";
import { formatLocalizedDate } from "@/lib/i18n/format";
import type { MissionControlState } from "@/features/mission-control/types/mission-control-state";
import { useMissionControlState } from "@/features/mission-control/hooks/useMissionControlState";
import { useI18n } from "@/lib/i18n/client";
import { DeploymentBlockersList } from "./production-readiness/DeploymentBlockersList";
import { ProjectHomeActions } from "./ProjectHomeActions";
import { MissionControlHero } from "./MissionControlHero";
import { MissionControlPrimaryAction } from "./MissionControlPrimaryAction";
import { SafeFixHeroCard } from "@/features/production-verdict/components/SafeFixHeroCard";
import { fixPromptInputFromPriority, findingsByIdMap } from "@/brain/fix-prompt";
import { MissionControlTechnicalDetails } from "./MissionControlTechnicalDetails";
import { MissionControlProtectionStatus } from "./MissionControlProtectionStatus";
import { AnalysisRunSelector } from "@/features/analysis-runs/components/AnalysisRunSelector";
import { ProjectOnboardedBanner } from "@/features/projects/components/ProjectOnboardedBanner";

const SCAN_LABEL_KEYS = {
  cta: "projectHome.scanCode.cta",
  running: "projectHome.scanCode.running",
  rescan: "projectHome.scanCode.rescan",
  retry: "projectHome.scanCode.retry",
} as const;

const PRIMARY_SCAN_LABEL_KEYS = {
  run_review: "actions.reviewAgain",
  run_review_again: "actions.reviewAgain",
} as const;

export function MissionControlExperience({
  initialState,
}: {
  initialState: MissionControlState;
}) {
  const { t, locale } = useI18n("missionControl");
  const { t: tp } = useI18n("projects");
  const {
    state,
    scanAction,
    securityAction,
    actionError,
    startScan,
    startSecurityTest,
  } = useMissionControlState(initialState.projectId, {
    initialState,
    analysisRunId: initialState.analysisRunId,
  });

  const verdict = state.productionVerdict;
  const primaryActionKind = state.actions.primary.kind;

  const topPriority = verdict?.topPriorities?.[0] ?? null;
  const safeFixPromptInput =
    topPriority && verdict && verdict.status !== "ready_to_ship"
      ? fixPromptInputFromPriority(topPriority, {
          projectName: state.projectName,
          stack: state.ui.fixPromptContext?.stack,
          findingsById: state.ui.fixPromptContext?.findings
            ? findingsByIdMap(state.ui.fixPromptContext.findings)
            : undefined,
          currentVerdictStatus: verdict.status,
          currentScore: verdict.score,
        })
      : null;

  const showSafeFixCard =
    primaryActionKind === "copy_safe_fix" && topPriority && safeFixPromptInput;

  const blockers = verdict?.topPriorities ?? [];
  const showBlockers = blockers.length > 0 && verdict?.status !== "ready_to_ship";

  const scanProgress =
    state.status.reviewInProgress && state.status.progressMessage
      ? state.status.progressMessage
      : state.status.reviewInProgress && state.status.progress != null
        ? `${state.status.progress}%`
        : null;

  const primaryScanLabel =
    primaryActionKind === "run_review"
      ? tp("runProductionReview")
      : primaryActionKind === "run_review_again"
        ? t(PRIMARY_SCAN_LABEL_KEYS.run_review_again)
        : t(SCAN_LABEL_KEYS[scanAction.label]);

  const recoveryBannerKey =
    state.recoveryReason === "scoped_verdict_missing"
      ? "analysisRun.autoRecoveryBanner"
      : "analysisRun.recoveryBanner";

  return (
    <div className="space-y-10 max-w-2xl mx-auto">
      {state.ui.viewingHistoricalRun ? (
        <div
          className="rounded-2xl border border-border/60 bg-muted/20 px-5 py-4 text-sm text-muted-foreground"
          role="status"
        >
          {t("analysisRun.historicalBanner")}
        </div>
      ) : null}

      {state.ui.showRecoveryBanner ? (
        <div
          className="rounded-2xl border border-brand-warning/30 bg-brand-warning/5 px-5 py-4 text-sm text-foreground/90"
          role="status"
        >
          {t(recoveryBannerKey)}
        </div>
      ) : null}

      {state.ui.showAnalysisRunSelector ? (
        <Suspense fallback={null}>
          <AnalysisRunSelector runs={state.analysisRuns} activeRunId={state.analysisRunId} />
        </Suspense>
      ) : null}

      {state.ui.showOnboardedBanner && verdict ? (
        <ProjectOnboardedBanner readyToShip={verdict.status === "ready_to_ship"} />
      ) : null}

      {state.ui.showConnectedBanner ? (
        <div className="surface-premium rounded-2xl p-5" role="status">
          <p className="text-sm font-medium">{tp("connectedGuidanceTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{tp("connectedGuidanceBody")}</p>
        </div>
      ) : null}

      {state.ui.showReviewCompleteBanner && verdict ? (
        <div className="surface-premium rounded-2xl p-5" role="status">
          <p className="text-sm font-medium">{tp("reviewCompleteGuidanceTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{tp("reviewCompleteGuidanceBody")}</p>
        </div>
      ) : null}

      {state.ui.isVerdictStale && !state.ui.viewingHistoricalRun ? (
        <div
          className="rounded-2xl border border-brand-warning/30 bg-brand-warning/5 px-5 py-4 text-sm text-foreground/90"
          role="alert"
        >
          {tp("latestCommitNotReviewedBanner")}
        </div>
      ) : null}

      <ProjectHomeActions
        state={state}
        scanAction={scanAction}
        securityAction={securityAction}
        actionError={actionError}
        onStartScan={() => void startScan()}
        onStartSecurityTest={() => void startSecurityTest()}
      />

      {state.status.reviewInProgress && !verdict ? (
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

          {showBlockers ? <DeploymentBlockersList blockers={blockers} /> : null}

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
            projectName={state.projectName}
            fixPromptContext={state.ui.fixPromptContext}
            reportHref={state.ui.reportHref}
            attackCenterHref={state.ui.attackCenterHref}
            scanLabel={primaryScanLabel}
            scanLoading={scanAction.showSpinner}
            scanDisabled={scanAction.disabled}
            scanProgress={scanProgress}
            onStartScan={() => void startScan()}
          />

          {state.ui.showProtectionStatus && state.protectionCenter ? (
            <MissionControlProtectionStatus model={state.protectionCenter} />
          ) : null}

          <MissionControlTechnicalDetails
            view={state.view}
            verdict={verdict}
            framework={state.framework}
            reportHref={state.ui.reportHref}
            openByDefault={state.ui.openTechnicalDetails}
          />
        </>
      ) : null}

      {state.view.cancelledReview ? (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{t("feed.reviewStopped")}</p>
          <p className="mt-1">{formatLocalizedDate(locale, state.view.cancelledReview.cancelledAt)}</p>
        </div>
      ) : null}
    </div>
  );
}
