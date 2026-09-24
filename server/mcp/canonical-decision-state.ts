import "server-only";

import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import {
  getAuthoritativeProductionVerdict,
  type AuthoritativeProductionVerdict,
} from "@/server/production-verdict/authoritative-verdict";
import type { McpAuthContext } from "./auth";
import { mapVerdictStatusToDecision, type DeploymentDecision } from "./decision-mapping";
import {
  evaluateDeployDecision,
  type DeployDecisionEvaluation,
} from "./deploy-decision/evaluate-deploy-decision";
import { getLatestReviewSummary, type LatestReviewSummary } from "./latest-review";
import type { StalenessFootnotes } from "./personality";
import {
  deriveDecisionLanguagePolicy,
  type DecisionLanguagePolicy,
} from "./decision-language-policy";
import { getStalenessInfo, type StalenessInfo } from "./staleness";
import { finalizeVerdictWhenEvidenceComplete } from "@/server/production-verdict/evidence-finalization";

/**
 * The single place that decides what "the current deployment decision" is
 * for a project. Every decision-facing MCP tool (can_i_deploy, safe_fix,
 * what_changed, production_history) must derive its readiness semantics
 * from this state rather than re-deriving them, so two tools can never
 * describe the same evaluation with contradictory decisions.
 *
 * Field authority:
 *  - AUTHORITATIVE: `verdict` (the persisted Production Verdict),
 *    `decision`, `reviewInProgress`, `reviewFailed`, `deployEvaluation`.
 *  - DIAGNOSTIC: `authoritative.liveVerdict` / `authoritative.consistency`
 *    (recomputation surfaced only to expose divergence, never to decide).
 *  - HISTORICAL: anything read from production_verdicts history rows.
 */
export type CanonicalDecisionState = {
  authoritative: AuthoritativeProductionVerdict;
  verdict: ProductionVerdictV1;
  staleness: StalenessInfo;
  latestReview: LatestReviewSummary;
  deployEvaluation: DeployDecisionEvaluation;
  reviewInProgress: boolean;
  reviewFailed: boolean;
  /** Final decision after deferral (running/failed/cancelled review) and failed-review downgrade. */
  decision: DeploymentDecision;
  stalenessFootnotes: StalenessFootnotes;
  /**
   * True only when the current evidence genuinely supports "nothing to fix":
   * a ready verdict that is not deferred, not being replaced by a running
   * review, and known to describe the latest commit. Anything weaker must
   * never be described to an agent as "nothing is blocking deploy".
   */
  isCleanAndCurrent: boolean;
  /** Deterministic ceiling on decision wording; every decision-facing text obeys it. */
  languagePolicy: DecisionLanguagePolicy;
};

export async function resolveCanonicalDecisionState(
  ctx: McpAuthContext,
  projectId: string
): Promise<CanonicalDecisionState | null> {
  // Self-heal: a completed scan whose engines have all finished but whose
  // verdict was never written (its finalizing event was missed) gets it now,
  // so the decision is never stuck "awaiting a verdict" for finished evidence.
  try {
    const latest = await getLatestReviewSummary(ctx.admin, projectId);
    if (latest && latest.status === "completed") {
      await finalizeVerdictWhenEvidenceComplete(ctx.admin, {
        organizationId: ctx.organizationId,
        projectId,
        scanId: latest.id,
        mode: "pipeline",
      });
    }
  } catch {
    // Read paths never fail because a repair attempt failed.
  }

  const authoritative = await getAuthoritativeProductionVerdict(
    ctx.admin,
    ctx.organizationId,
    projectId
  );
  if (!authoritative) return null;

  const verdict = authoritative.verdict;
  const [staleness, latestReview] = await Promise.all([
    getStalenessInfo(ctx.admin, projectId, verdict.commitSha),
    getLatestReviewSummary(ctx.admin, projectId),
  ]);

  const deployEvaluation = evaluateDeployDecision({
    latestReview: latestReview
      ? {
          id: latestReview.id,
          status: latestReview.status,
          commitSha: latestReview.commitSha,
          errorCode: latestReview.errorCode,
        }
      : null,
    historicalVerdict: {
      scanId: verdict.scanId,
      commitSha: verdict.commitSha,
      status: verdict.status,
      score: verdict.score,
    },
  });

  const deferred = deployEvaluation.kind === "deferred";
  const reviewInProgress =
    deferred &&
    (deployEvaluation.reason === "in_progress" || deployEvaluation.reason === "awaiting_verdict")
      ? true
      : staleness.reviewInProgress;
  const reviewFailed =
    deferred && (deployEvaluation.reason === "failed" || deployEvaluation.reason === "timed_out")
      ? true
      : staleness.reviewFailed;

  const engineDecision = mapVerdictStatusToDecision(verdict.status);
  const baseDecision: DeploymentDecision = deferred
    ? "more_analysis_required"
    : staleness.reviewFailed && engineDecision === "deploy"
      ? "more_analysis_required"
      : engineDecision;
  // A status-only "deploy" is never enough: confidence, coverage and
  // freshness may only ever weaken it (never strengthen).
  const languagePolicy = deriveDecisionLanguagePolicy({
    status: verdict.status,
    confidence: verdict.confidence,
    unevaluatedAreaCount: verdict.unevaluatedAreas.length,
    partiallyEvaluatedAreaCount: verdict.partiallyEvaluatedAreas.length,
    baseDecision,
    freshnessStatus: staleness.freshnessStatus,
    reviewInProgress,
    reviewFailed,
  });
  const decision: DeploymentDecision = languagePolicy.decision;

  const stalenessFootnotes: StalenessFootnotes = {
    reviewInProgress,
    freshnessStatus: staleness.freshnessStatus,
    reviewFailed,
    latestDetectedCommitSha: staleness.latestDetectedCommitSha,
  };

  const isCleanAndCurrent =
    decision === "deploy" &&
    !deferred &&
    !reviewInProgress &&
    !reviewFailed &&
    staleness.freshnessStatus === "current";

  return {
    authoritative,
    verdict,
    staleness,
    latestReview,
    deployEvaluation,
    reviewInProgress,
    reviewFailed,
    decision,
    stalenessFootnotes,
    isCleanAndCurrent,
    languagePolicy,
  };
}
