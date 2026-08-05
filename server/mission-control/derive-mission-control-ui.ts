import "server-only";

import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import type { AnalysisRunListItem } from "@/server/analysis-runs/list-analysis-runs";
import type { ProductionReviewState } from "@/lib/review/production-review-state";
import type {
  MissionControlPrimaryActionKind,
  MissionControlScanButtonLabel,
  MissionControlSecurityButtonLabel,
} from "@/features/mission-control/types/mission-control-state";
import type { SecurityTestPhase } from "@/features/security-testing/types";
import {
  deriveScanCodeButtonState,
  scanCodeButtonDisabled,
  type ScanCodeButtonState,
} from "@/lib/review/scan-code-button-state";
import { productionReviewShowsSpinner } from "@/lib/review/production-review-state";

export function resolveActiveRun(
  analysisRuns: AnalysisRunListItem[],
  activeRunId: string | null
): AnalysisRunListItem | null {
  if (activeRunId) {
    return analysisRuns.find((run) => run.runId === activeRunId) ?? null;
  }
  return analysisRuns[0] ?? null;
}

export function resolveLatestRun(analysisRuns: AnalysisRunListItem[]): AnalysisRunListItem | null {
  const completed = analysisRuns.find((run) => run.status === "completed");
  return completed ?? analysisRuns[0] ?? null;
}

/**
 * Single timestamp source: verdict time, then completed_at, then created_at for completed runs.
 */
export function deriveLastAnalysisAt(input: {
  productionVerdict: ProductionVerdictV1 | null;
  activeRun: AnalysisRunListItem | null;
  latestRun: AnalysisRunListItem | null;
  productionReviewState: ProductionReviewState;
}): string | null {
  if (input.productionVerdict?.generatedAt) {
    return input.productionVerdict.generatedAt;
  }

  const run =
    input.activeRun?.status === "completed"
      ? input.activeRun
      : input.latestRun?.status === "completed"
        ? input.latestRun
        : null;

  if (run) {
    return run.completedAt ?? run.createdAt;
  }

  if (input.productionReviewState.status === "completed" && input.productionReviewState.completedAt) {
    return input.productionReviewState.completedAt;
  }

  return null;
}

export function deriveHasCompletedAnalysis(input: {
  productionVerdict: ProductionVerdictV1 | null;
  activeRun: AnalysisRunListItem | null;
  latestRun: AnalysisRunListItem | null;
  productionReviewState: ProductionReviewState;
}): boolean {
  if (input.productionVerdict) return true;
  if (input.productionReviewState.status === "completed") return true;
  return false;
}

export function deriveReviewInProgress(input: {
  productionReviewState: ProductionReviewState;
  activeRunId: string | null;
  isolationEnabled: boolean;
}): boolean {
  if (!input.productionReviewState.hasActiveReview) return false;
  if (!input.isolationEnabled || !input.activeRunId) {
    return input.productionReviewState.hasActiveReview;
  }
  return input.productionReviewState.scanId === input.activeRunId;
}

function mapScanButtonLabel(state: ScanCodeButtonState): MissionControlScanButtonLabel {
  switch (state) {
    case "idle":
      return "cta";
    case "running":
      return "running";
    case "completed":
      return "rescan";
    case "failed":
      return "retry";
  }
}

export function deriveScanAction(input: {
  reviewInProgress: boolean;
  hasCompletedAnalysis: boolean;
  productionReviewState: ProductionReviewState;
  githubNeedsReconnect: boolean;
}): {
  label: MissionControlScanButtonLabel;
  disabled: boolean;
  showSpinner: boolean;
} {
  if (input.githubNeedsReconnect) {
    return { label: "cta", disabled: false, showSpinner: false };
  }

  const uiStatus = input.productionReviewState.status;
  const scanCardState = deriveScanCodeButtonState({
    uiStatus,
    requesting: false,
    reviewInProgress: input.reviewInProgress,
    hasCompletedAnalysis: input.hasCompletedAnalysis,
  });

  return {
    label: mapScanButtonLabel(scanCardState),
    disabled: scanCodeButtonDisabled(scanCardState),
    showSpinner:
      scanCardState === "running" ||
      productionReviewShowsSpinner(uiStatus),
  };
}

export function deriveSecurityAction(input: {
  phase: SecurityTestPhase;
  reviewInProgress: boolean;
  attackCenterEnabled: boolean;
}): {
  label: MissionControlSecurityButtonLabel;
  disabled: boolean;
  showSpinner: boolean;
} {
  if (!input.attackCenterEnabled) {
    return { label: "cta", disabled: true, showSpinner: false };
  }

  const running =
    input.phase === "preparing" ||
    input.phase === "running" ||
    (input.phase === "needs_review" && input.reviewInProgress);

  return {
    label: running ? "running" : "cta",
    disabled: running,
    showSpinner: running,
  };
}

export function deriveSecurityRunning(phase: SecurityTestPhase): boolean {
  return phase === "preparing" || phase === "running";
}

export function derivePrimaryActionKind(input: {
  verdict: ProductionVerdictV1 | null;
  securityPhase: SecurityTestPhase;
  reviewInProgress: boolean;
}): MissionControlPrimaryActionKind {
  const { verdict, securityPhase, reviewInProgress } = input;

  if (reviewInProgress || securityPhase === "preparing" || securityPhase === "running") {
    return "none";
  }

  if (!verdict) {
    return "run_review";
  }

  if (verdict.status === "ready_to_ship") {
    return "run_review_again";
  }

  if (securityPhase === "protected" || securityPhase === "completed_clean") {
    return "run_review_again";
  }

  if (securityPhase === "fix_ready" || securityPhase === "issues_found") {
    return "verify_protection";
  }

  if ((verdict.topPriorities?.length ?? 0) > 0) {
    return "copy_safe_fix";
  }

  return "run_review_again";
}
