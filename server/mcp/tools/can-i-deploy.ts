import "server-only";

import { getCurrentProductionVerdict } from "@/server/production-verdict/service";
import type { McpAuthContext } from "../auth";
import { McpError } from "../auth";
import { mapVerdictStatusToDecision } from "../decision-mapping";
import {
  evaluateDeployDecision,
} from "../deploy-decision/evaluate-deploy-decision";
import type { McpTranslator } from "../i18n";
import { getLatestReviewSummary } from "../latest-review";
import {
  formatCanIDeployDeferredResponse,
  formatCanIDeployResponse,
  pickRecommendedAction,
} from "../personality";
import type { ProjectSelector } from "../project-resolution";
import { resolveMcpProject } from "../project-resolution";
import { buildProjectReportUrl } from "../report-url";
import { getStalenessInfo } from "../staleness";
import { applyLatestSecurityDecisionToVerdict } from "../security-decision-overlay";

export type CanIDeployInput = ProjectSelector;

export type CanIDeployBlocker = {
  id: string;
  title: string;
  severity: string;
  category: string;
};

export type CanIDeployResult = {
  mode: "production_review";
  project: { id: string; name: string; repositoryFullName: string | null };
  verdictStatus: string;
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

  let verdict = await getCurrentProductionVerdict(ctx.admin, project.id);
  if (!verdict) {
    throw new McpError(404, "no_verdict_available", t("errors.no_verdict_available"));
  }

  const securityOverlay = applyLatestSecurityDecisionToVerdict(project.id, verdict, {
    organizationId: ctx.organizationId,
  });
  verdict = securityOverlay.verdict;

  const [staleness, latestReview] = await Promise.all([
    getStalenessInfo(ctx.admin, project.id, verdict.commitSha),
    getLatestReviewSummary(ctx.admin, project.id),
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

  const topBlockers: CanIDeployBlocker[] = verdict.topPriorities.slice(0, 3).map((priority) => ({
    id: priority.id,
    title: priority.title,
    severity: priority.severity,
    category: priority.category,
  }));

  const worries = topBlockers.map((b) => b.title);
  const reviewInProgress =
    deployEvaluation.kind === "deferred" &&
    (deployEvaluation.reason === "in_progress" || deployEvaluation.reason === "awaiting_verdict")
      ? true
      : staleness.reviewInProgress;

  const stalenessFootnotes = {
    reviewInProgress,
    freshnessStatus: staleness.freshnessStatus,
    reviewFailed: staleness.reviewFailed,
    latestDetectedCommitSha: staleness.latestDetectedCommitSha,
  };

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
      project,
      verdictStatus: verdict.status,
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

  const engineDecision = mapVerdictStatusToDecision(verdict.status);
  const decision =
    staleness.reviewFailed && engineDecision === "deploy" ? "more_analysis_required" : engineDecision;
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
    project,
    verdictStatus: verdict.status,
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
