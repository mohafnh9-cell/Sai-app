"use client";

import { Suspense } from "react";
import { formatLocalizedDate } from "@/lib/i18n/format";
import type { ProductionIntelligence } from "@/brain/production-intelligence/schema";
import type { AreaProgress } from "@/brain/production-journey/schema";
import type { MissionControlState } from "@/features/mission-control/types/mission-control-state";
import { useMissionControlState } from "@/features/mission-control/hooks/useMissionControlState";
import { useI18n } from "@/lib/i18n/client";
import { ProjectHomeActions } from "./ProjectHomeActions";
import { MissionControlPrimaryAction } from "./MissionControlPrimaryAction";
import { ProductionIntelligenceView } from "./ProductionIntelligenceView";
import { fixPromptInputFromPriority, findingsByIdMap } from "@/brain/fix-prompt";
import { AnalysisRunSelector } from "@/features/analysis-runs/components/AnalysisRunSelector";
import { ProjectOnboardedBanner } from "@/features/projects/components/ProjectOnboardedBanner";
import { McpPromoBanner } from "@/features/mcp/components/McpPromoBanner";
import { MissionControlActivityBanner } from "./MissionControlActivityBanner";
import { MissionControlProtectionStatus } from "./MissionControlProtectionStatus";
import { useProtectionCenter } from "@/features/continuous-protection/hooks/useProtectionCenter";

export function MissionControlExperience({
  initialState,
  productionIntelligence = null,
  areasProgress = [],
}: {
  initialState: MissionControlState;
  productionIntelligence?: ProductionIntelligence | null;
  areasProgress?: AreaProgress[];
}) {
  const { t, locale } = useI18n("missionControl");
  const { t: tp } = useI18n("projects");
  const {
    state,
    scanAction,
    securityAction,
    actionError,
    reauthRequired,
    subscriptionRequired,
    startScan,
    startSecurityTest,
  } = useMissionControlState(initialState.projectId, {
    initialState,
    analysisRunId: initialState.analysisRunId,
  });
  const { data: protectionCenter } = useProtectionCenter(initialState.projectId);

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

  const showScanActivity = state.status.reviewInProgress;
  const showAttackActivity = state.status.securityRunning;
  const staleVerdictWhileBusy = Boolean(verdict && (showScanActivity || showAttackActivity));
  const openFullReport =
    state.ui.openTechnicalDetails ||
    state.ui.showReviewCompleteBanner ||
    Boolean(verdict && state.status.hasCompletedAnalysis);

  const recoveryBannerKey =
    state.recoveryReason === "scoped_verdict_missing"
      ? "analysisRun.autoRecoveryBanner"
      : "analysisRun.recoveryBanner";

  return (
    <div className="space-y-10 max-w-5xl mx-auto">
      {state.ui.viewingHistoricalRun ? (
        <div
          className="rounded-xl border border-border/60 bg-muted/20 px-5 py-4 text-sm text-muted-foreground"
          role="status"
        >
          {t("analysisRun.historicalBanner")}
        </div>
      ) : null}

      {state.ui.showRecoveryBanner ? (
        <div
          className="rounded-xl border border-warning/30 bg-warning/5 px-5 py-4 text-sm"
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
      ) : (
        <McpPromoBanner />
      )}

      {state.ui.showConnectedBanner ? (
        <div className="rounded-xl border border-border/60 bg-muted/20 p-5" role="status">
          <p className="text-sm font-medium">{tp("connectedGuidanceTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{tp("connectedGuidanceBody")}</p>
        </div>
      ) : null}

      {state.ui.showReviewCompleteBanner && verdict ? (
        <div className="rounded-xl border border-border/60 bg-muted/20 p-5" role="status">
          <p className="text-sm font-medium">{tp("reviewCompleteGuidanceTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{tp("reviewCompleteGuidanceBody")}</p>
        </div>
      ) : null}

      {state.ui.isVerdictStale && !state.ui.viewingHistoricalRun ? (
        <div className="rounded-xl border border-warning/30 bg-warning/5 px-5 py-4 text-sm" role="alert">
          {tp("latestCommitNotReviewedBanner")}
        </div>
      ) : null}

      <ProjectHomeActions
        state={state}
        scanAction={scanAction}
        securityAction={securityAction}
        actionError={actionError}
        reauthRequired={reauthRequired}
        subscriptionRequired={subscriptionRequired}
        onStartScan={() => void startScan()}
        onStartSecurityTest={() => void startSecurityTest()}
      />

      {protectionCenter ? <MissionControlProtectionStatus model={protectionCenter} /> : null}

      {showScanActivity && !verdict ? (
        <MissionControlActivityBanner
          kind="scan"
          progress={state.status.progress}
          progressMessage={state.status.progressMessage}
        />
      ) : null}

      {verdict ? (
        <ProductionIntelligenceView
          state={state}
          intelligence={productionIntelligence}
          areasProgress={areasProgress}
          showScanActivity={showScanActivity}
          showAttackActivity={showAttackActivity}
          staleVerdictWhileBusy={staleVerdictWhileBusy}
          showSafeFixCard={Boolean(showSafeFixCard)}
          safeFixPromptInput={safeFixPromptInput}
          topPriority={topPriority}
          openFullReport={openFullReport}
        />
      ) : null}

      {!verdict && !showScanActivity ? (
        <div className="rounded-xl border border-dashed border-border/60 px-5 py-10 text-center space-y-2" role="status">
          <p className="text-sm font-medium">{t("empty.noVerdictTitle")}</p>
          <p className="text-sm text-muted-foreground">{t("empty.noVerdictBody")}</p>
        </div>
      ) : null}

      {/*
       * "run_review" / "run_review_again" are excluded here: ProjectHomeActions
       * above already renders that exact scan action, so repeating it below
       * would put two identical "rescan" buttons on the same page.
       */}
      {verdict &&
      !showSafeFixCard &&
      primaryActionKind !== "run_review" &&
      primaryActionKind !== "run_review_again" ? (
        <MissionControlPrimaryAction
          state={state}
          scanAction={scanAction}
          onStartScan={() => void startScan()}
        />
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
