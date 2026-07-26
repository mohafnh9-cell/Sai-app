import { isActiveReviewScanStatus } from "@/brain/automatic-review/review-status";
import { REVIEW_STALE_FAILURE_CODE } from "@/server/review-recovery/stale-review";

export type LatestReviewSnapshot = {
  id: string;
  status: string;
  commitSha: string | null;
  errorCode: string | null;
};

export type HistoricalVerdictSnapshot = {
  scanId: string;
  commitSha: string | null;
  status: string;
  score: number | null;
};

export type DeployDeferReason =
  | "in_progress"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "awaiting_verdict";

export type DeployDecisionEvaluation =
  | { kind: "answerable" }
  | {
      kind: "deferred";
      reason: DeployDeferReason;
      latestReview: LatestReviewSnapshot;
      historicalVerdict: HistoricalVerdictSnapshot;
    };

function defer(
  reason: DeployDeferReason,
  latestReview: LatestReviewSnapshot,
  historicalVerdict: HistoricalVerdictSnapshot
): DeployDecisionEvaluation {
  return { kind: "deferred", reason, latestReview, historicalVerdict };
}

function verdictMatchesLatestReview(
  latestReview: LatestReviewSnapshot,
  historicalVerdict: HistoricalVerdictSnapshot
): boolean {
  if (latestReview.id === historicalVerdict.scanId) return true;
  return Boolean(
    latestReview.commitSha &&
      historicalVerdict.commitSha &&
      latestReview.commitSha === historicalVerdict.commitSha
  );
}

/**
 * Determines whether can_i_deploy may issue YES / NO / NOT YET from the
 * persisted production verdict, or must defer until the newest review finishes.
 */
export function evaluateDeployDecision(input: {
  latestReview: LatestReviewSnapshot | null;
  historicalVerdict: HistoricalVerdictSnapshot;
}): DeployDecisionEvaluation {
  const { latestReview, historicalVerdict } = input;
  if (!latestReview) {
    return { kind: "answerable" };
  }

  if (isActiveReviewScanStatus(latestReview.status)) {
    return defer("in_progress", latestReview, historicalVerdict);
  }

  if (latestReview.status === "failed") {
    const reason =
      latestReview.errorCode === REVIEW_STALE_FAILURE_CODE ? "timed_out" : "failed";
    return defer(reason, latestReview, historicalVerdict);
  }

  if (latestReview.status === "cancelled") {
    return defer("cancelled", latestReview, historicalVerdict);
  }

  if (latestReview.status === "completed") {
    if (verdictMatchesLatestReview(latestReview, historicalVerdict)) {
      return { kind: "answerable" };
    }
    return defer("awaiting_verdict", latestReview, historicalVerdict);
  }

  return { kind: "answerable" };
}

export function shortSha(sha: string | null | undefined): string {
  if (!sha) return "unknown";
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}
