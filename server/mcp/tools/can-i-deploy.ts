import "server-only";

import type { McpAuthContext } from "../auth";
import { McpError } from "../auth";
import { resolveCanonicalDecisionState } from "../canonical-decision-state";
import type { McpTranslator } from "../i18n";
import {
  formatCanIDeployDeferredResponse,
  formatCanIDeployResponse,
  pickRecommendedAction,
} from "../personality";
import type { ProjectSelector } from "../project-resolution";
import { resolveMcpProject } from "../project-resolution";
import { buildProjectReportUrl } from "../report-url";
import { applyLatestSecurityDecisionToVerdict } from "../security-decision-overlay";
import type { VerdictConsistency } from "@/server/production-verdict/authoritative-verdict";
import { resolveVerdictSourceForScan } from "../verdict-source";
import type { ConfidenceLevel } from "@/brain/confidence/types";
import { deriveConfidenceLevel } from "@/brain/confidence/derive";

export type CanIDeployInput = ProjectSelector;

export type CanIDeployBlocker = {
  id: string;
  title: string;
  severity: string;
  category: string;
  confidence: ConfidenceLevel;
};

export type CanIDeployResult = {
  mode: "production_review";
  source: "github" | "pr";
  authoritative: "persisted";
  consistency: VerdictConsistency;
  liveVerdictStatus?: string | null;
  liveScore?: number | null;
  project: { id: string; name: string; repositoryFullName: string | null };
  verdictStatus: string;
  /** Scan the authoritative verdict was generated from. */
  verdictScanId: string;
  score: number | null;
  scoreDelta: number | null;
  confidenceBand: "high" | "medium" | "low";
  blockersCount: number;
  topBlockers: CanIDeployBlocker[];
  nextAction: string;
  evaluatedCoverage: {
    ratio: number | null;
    evaluatedAreas: number;
    partiallyEvaluatedAreas: number;
    unevaluatedAreas: number;
  };
  generatedAt: string;
  reviewedCommitSha: string | null;
  latestDetectedCommitSha: string | null;
  stale: boolean;
  freshnessStatus: "current" | "stale" | "unknown";
  reviewInProgress: boolean;
  reviewFailed: boolean;
  latestReviewId: string | null;
  latestReviewStatus: string | null;
  deploymentRecommendation: "SHIP_IT" | "DO_NOT_DEPLOY" | "MORE_ANALYSIS_REQUIRED";
  reportUrl: string | null;
  summary: string;
};

export async function canIDeploy(
  ctx: McpAuthContext,
  input: CanIDeployInput,
  t: McpTranslator
): Promise<CanIDeployResult> {
  const project = await resolveMcpProject(ctx, input, t);

  // The single decision authority shared by every decision-facing MCP tool
  // (can_i_deploy, safe_fix, what_changed, production_history): persisted
  // verdict + staleness + latest review + deferral, resolved once.
  const state = await resolveCanonicalDecisionState(ctx, project.id);
  if (!state) {
    throw new McpError(404, "no_verdict_available", t("errors.no_verdict_available"));
  }
  const { authoritative, staleness, latestReview, deployEvaluation, reviewInProgress, stalenessFootnotes } =
    state;

  let verdict = state.verdict;
  const rawSource = await resolveVerdictSourceForScan(ctx.admin, verdict.scanId);
  const source: "github" | "pr" = rawSource === "pr" ? "pr" : "github";

  // ADVISORY: the AI red-team decision may only annotate an evidence-complete
  // verdict; it can never promote an insufficient one (see the overlay).
  const securityOverlay = applyLatestSecurityDecisionToVerdict(project.id, verdict);
  verdict = securityOverlay.verdict;

  const topBlockers: CanIDeployBlocker[] = verdict.topPriorities.slice(0, 3).map((priority) => ({
    id: priority.id,
    title: priority.title,
    severity: priority.severity,
    category: priority.category,
    confidence:
      priority.confidenceLevel ??
      deriveConfidenceLevel({ legacyBand: priority.confidence }),
  }));

  const worries = topBlockers.map((b) => b.title);

  if (deployEvaluation.kind === "deferred") {
    const summary = formatCanIDeployDeferredResponse(t, {
      reason: deployEvaluation.reason,
      currentCommitSha: deployEvaluation.latestReview.commitSha,
      historicalVerdict: {
        commitSha: verdict.commitSha,
        status: verdict.status,
        score: verdict.score,
      },
    });

    return {
      mode: "production_review",
      source,
      authoritative: "persisted",
      consistency: authoritative.consistency,
      liveVerdictStatus: authoritative.liveVerdict?.status ?? null,
      liveScore: authoritative.liveVerdict?.score ?? null,
      project,
      verdictStatus: verdict.status,
    verdictScanId: verdict.scanId,
      score: verdict.score,
      scoreDelta: verdict.scoreDelta,
      confidenceBand: verdict.confidence,
      blockersCount: verdict.blockersCount,
      topBlockers,
      nextAction: t("actions.waitForReview"),
      evaluatedCoverage: {
        ratio: verdict.coverageRatio,
        evaluatedAreas: verdict.evaluatedAreas.length,
        partiallyEvaluatedAreas: verdict.partiallyEvaluatedAreas.length,
        unevaluatedAreas: verdict.unevaluatedAreas.length,
      },
      generatedAt: verdict.generatedAt,
      reviewedCommitSha: verdict.commitSha,
      latestDetectedCommitSha: staleness.latestDetectedCommitSha,
      stale: staleness.stale,
      freshnessStatus: staleness.freshnessStatus,
      reviewInProgress,
      reviewFailed:
        deployEvaluation.reason === "failed" || deployEvaluation.reason === "timed_out"
          ? true
          : staleness.reviewFailed,
      latestReviewId: latestReview?.id ?? null,
      latestReviewStatus: latestReview?.status ?? null,
      deploymentRecommendation: "MORE_ANALYSIS_REQUIRED",
      reportUrl: buildProjectReportUrl(project.id),
      summary,
    };
  }

  const decision = state.decision;
  type McpDeploymentRecommendation = "DO_NOT_DEPLOY" | "SHIP_IT" | "MORE_ANALYSIS_REQUIRED";
  let deploymentRecommendation: McpDeploymentRecommendation =
    decision === "deploy" ? "SHIP_IT" : decision === "do_not_deploy" ? "DO_NOT_DEPLOY" : "MORE_ANALYSIS_REQUIRED";

  if (securityOverlay.applied && securityOverlay.deploymentRecommendation) {
    deploymentRecommendation = securityOverlay.deploymentRecommendation;
  }

  const nextAction = pickRecommendedAction(t, {
    decision,
    status: verdict.status,
    blockersCount: verdict.blockersCount,
    staleness: stalenessFootnotes,
  });

  const summary = formatCanIDeployResponse(t, {
    decision,
    status: verdict.status,
    executiveSummary: securityOverlay.executiveSummarySuffix
      ? `${verdict.executiveSummary} ${securityOverlay.executiveSummarySuffix}`
      : verdict.executiveSummary,
    worries,
    blockersCount: verdict.blockersCount,
    staleness: stalenessFootnotes,
  });

  return {
    mode: "production_review",
    source,
    authoritative: "persisted",
    consistency: authoritative.consistency,
    liveVerdictStatus: authoritative.liveVerdict?.status ?? null,
    liveScore: authoritative.liveVerdict?.score ?? null,
    project,
    verdictStatus: verdict.status,
    verdictScanId: verdict.scanId,
    score: verdict.score,
    scoreDelta: verdict.scoreDelta,
    confidenceBand: verdict.confidence,
    blockersCount: verdict.blockersCount,
    topBlockers,
    nextAction,
    evaluatedCoverage: {
      ratio: verdict.coverageRatio,
      evaluatedAreas: verdict.evaluatedAreas.length,
      partiallyEvaluatedAreas: verdict.partiallyEvaluatedAreas.length,
      unevaluatedAreas: verdict.unevaluatedAreas.length,
    },
    generatedAt: verdict.generatedAt,
    reviewedCommitSha: verdict.commitSha,
    latestDetectedCommitSha: staleness.latestDetectedCommitSha,
    stale: staleness.stale,
    freshnessStatus: staleness.freshnessStatus,
    reviewInProgress,
    reviewFailed: staleness.reviewFailed,
    latestReviewId: latestReview?.id ?? null,
    latestReviewStatus: latestReview?.status ?? null,
    deploymentRecommendation,
    reportUrl: buildProjectReportUrl(project.id),
    summary,
  };
}
