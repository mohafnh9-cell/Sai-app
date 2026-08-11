import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MissionControlState } from "@/features/mission-control/types/mission-control-state";
import type { MissionControlLoadResult } from "./load-mission-control-with-recovery";
import type { MissionControlReviewSignals } from "./load-mission-control-review-signals";
import type { SecurityTestContext } from "@/features/security-testing/types";
import type { ProtectionCenterSnapshot } from "@/features/continuous-protection/types";
import type { AnalysisRunListItem } from "@/server/analysis-runs/list-analysis-runs";
import type { FixPromptContext } from "@/features/production-verdict/fix-prompt-context";
import {
  deriveHasCompletedAnalysis,
  deriveLastAnalysisAt,
  deriveReviewInProgress,
  deriveScanAction,
  deriveSecurityAction,
  deriveSecurityRunning,
  derivePrimaryActionKind,
  resolveActiveRun,
  resolveLatestRun,
} from "./derive-mission-control-ui";

export type BuildMissionControlStateInput = {
  projectId: string;
  projectName: string;
  framework: string | null;
  missionLoad: MissionControlLoadResult;
  analysisRuns: AnalysisRunListItem[];
  reviewSignals: MissionControlReviewSignals;
  securityTestContext: SecurityTestContext | null;
  protectionCenter: ProtectionCenterSnapshot | null;
  fixPromptContext?: FixPromptContext;
  reportHref?: string;
  flags: {
    analysisRunIsolationEnabled: boolean;
    attackCenterEnabled: boolean;
    continuousProtectionEnabled: boolean;
    manualRecovery: boolean;
  };
  ui: {
    openTechnicalDetails: boolean;
    onboarded?: boolean;
    connected?: boolean;
    reviewComplete?: boolean;
  };
};

export function buildMissionControlState(input: BuildMissionControlStateInput): MissionControlState {
  const { missionLoad, reviewSignals, analysisRuns } = input;
  const activeRunId = missionLoad.activeRunId;
  const activeRun = resolveActiveRun(analysisRuns, activeRunId);
  const latestRun = resolveLatestRun(analysisRuns);
  const productionReviewState = reviewSignals.productionReviewState;

  const reviewInProgress = deriveReviewInProgress({
    productionReviewState,
    activeRunId,
    isolationEnabled: input.flags.analysisRunIsolationEnabled,
  });

  const hasCompletedAnalysis = deriveHasCompletedAnalysis({
    productionVerdict: missionLoad.verdict,
    activeRun,
    latestRun,
    productionReviewState,
  });

  const lastAnalysisAt = deriveLastAnalysisAt({
    productionVerdict: missionLoad.verdict,
    activeRun,
    latestRun,
    productionReviewState,
  });

  const securityPhase = input.securityTestContext?.phase ?? "needs_review";
  const securityRunning = deriveSecurityRunning(securityPhase);
  const primaryActionKind = derivePrimaryActionKind({
    verdict: missionLoad.verdict,
    securityPhase,
    reviewInProgress,
  });

  const progress = reviewInProgress ? reviewSignals.progress : null;
  const progressMessage = reviewInProgress ? reviewSignals.progressMessage : null;

  const viewingHistoricalRun =
    input.flags.analysisRunIsolationEnabled &&
    missionLoad.runScoped &&
    Boolean(activeRunId) &&
    Boolean(productionReviewState.scanId) &&
    productionReviewState.hasActiveReview &&
    productionReviewState.scanId !== activeRunId;

  const showRecoveryBanner =
    input.flags.manualRecovery ||
    missionLoad.recoveryReason === "scoped_verdict_missing" ||
    missionLoad.recoveryReason === "manual_recovery";

  const showProtectionStatus =
    input.flags.continuousProtectionEnabled &&
    Boolean(missionLoad.verdict) &&
    !viewingHistoricalRun;

  return {
    projectId: input.projectId,
    projectName: input.projectName,
    framework: input.framework,
    analysisRunId: activeRunId,
    activeRun,
    latestRun,
    analysisRuns,
    runScoped: missionLoad.runScoped,
    recoveryReason: missionLoad.recoveryReason,
    productionVerdict: missionLoad.verdict,
    view: missionLoad.view,
    securityTestContext: input.securityTestContext,
    protectionCenter: input.protectionCenter,
    status: {
      reviewInProgress,
      securityRunning,
      progress,
      progressMessage,
      lastAnalysisAt,
      hasCompletedAnalysis,
      hasVerdict: Boolean(missionLoad.verdict),
      repositoryConnected: reviewSignals.repositoryConnected,
      repositoryOutOfSync: reviewSignals.repositoryOutOfSync,
      currentCommitSha:
        activeRun?.commitSha ??
        reviewSignals.currentCommitSha ??
        null,
    },
    actions: {
      scan: deriveScanAction({
        reviewInProgress,
        hasCompletedAnalysis,
        productionReviewState,
        githubNeedsReconnect: reviewSignals.githubNeedsReconnect,
      }),
      security: deriveSecurityAction({
        phase: securityPhase,
        reviewInProgress,
        attackCenterEnabled: input.flags.attackCenterEnabled,
      }),
      primary: {
        kind: primaryActionKind,
      },
    },
    flags: {
      analysisRunIsolationEnabled: input.flags.analysisRunIsolationEnabled,
      attackCenterEnabled: input.flags.attackCenterEnabled,
      continuousProtectionEnabled: input.flags.continuousProtectionEnabled,
    },
    ui: {
      viewingHistoricalRun,
      showRecoveryBanner,
      showProtectionStatus,
      isVerdictStale: reviewSignals.isVerdictStale && !viewingHistoricalRun,
      openTechnicalDetails: input.ui.openTechnicalDetails,
      showAnalysisRunSelector:
        input.flags.analysisRunIsolationEnabled && analysisRuns.length > 1,
      showOnboardedBanner: Boolean(input.ui.onboarded && missionLoad.verdict),
      showConnectedBanner: Boolean(input.ui.connected),
      showReviewCompleteBanner: Boolean(input.ui.reviewComplete && missionLoad.verdict),
      ...(input.reportHref ? { reportHref: input.reportHref } : {}),
      ...(input.fixPromptContext ? { fixPromptContext: input.fixPromptContext } : {}),
      ...(input.securityTestContext?.attackCenterHref
        ? { attackCenterHref: input.securityTestContext.attackCenterHref }
        : {}),
    },
  };
}

export async function loadAndBuildMissionControlState(
  supabase: SupabaseClient,
  input: Omit<BuildMissionControlStateInput, "missionLoad"> & {
    organizationId: string;
    analysisRunId: string | null;
    manualRecovery: boolean;
    admin: SupabaseClient | null;
  }
): Promise<MissionControlState> {
  const { loadMissionControlWithRecovery } = await import("./load-mission-control-with-recovery");
  const missionLoad = await loadMissionControlWithRecovery(
    supabase,
    input.projectId,
    input.organizationId,
    {
      analysisRunId: input.analysisRunId,
      isolationEnabled: input.flags.analysisRunIsolationEnabled,
      manualRecovery: input.manualRecovery,
      admin: input.admin,
    }
  );

  return buildMissionControlState({
    ...input,
    missionLoad,
  });
}
