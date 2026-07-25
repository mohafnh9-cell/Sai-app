import "server-only";

import { getCurrentProductionVerdict } from "@/server/production-verdict/service";
import type { McpAuthContext } from "../auth";
import { McpError } from "../auth";
import { mapVerdictStatusToDecision } from "../decision-mapping";
import type { McpTranslator } from "../i18n";
import { getLatestReviewSummary } from "../latest-review";
import { formatCanIDeployResponse, pickRecommendedAction } from "../personality";
import type { ProjectSelector } from "../project-resolution";
import { resolveMcpProject } from "../project-resolution";
import { buildProjectReportUrl } from "../report-url";
import { getStalenessInfo } from "../staleness";

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

  const verdict = await getCurrentProductionVerdict(ctx.admin, project.id);
  if (!verdict) {
    throw new McpError(404, "no_verdict_available", t("errors.no_verdict_available"));
  }

  const [staleness, latestReview] = await Promise.all([
    getStalenessInfo(ctx.admin, project.id, verdict.commitSha),
    getLatestReviewSummary(ctx.admin, project.id),
  ]);

  const engineDecision = mapVerdictStatusToDecision(verdict.status);
  const decision =
    staleness.reviewFailed && engineDecision === "deploy" ? "more_analysis_required" : engineDecision;
  const deploymentRecommendation =
    decision === "deploy" ? "SHIP_IT" : decision === "do_not_deploy" ? "DO_NOT_DEPLOY" : "MORE_ANALYSIS_REQUIRED";

  const topBlockers: CanIDeployBlocker[] = verdict.topPriorities.slice(0, 3).map((priority) => ({
    id: priority.id,
    title: priority.title,
    severity: priority.severity,
    category: priority.category,
  }));

  const worries = topBlockers.map((b) => b.title);
  const stalenessFootnotes = {
    reviewInProgress: staleness.reviewInProgress,
    freshnessStatus: staleness.freshnessStatus,
    reviewFailed: staleness.reviewFailed,
    latestDetectedCommitSha: staleness.latestDetectedCommitSha,
  };

  const nextAction = pickRecommendedAction(t, {
    decision,
    status: verdict.status,
    blockersCount: verdict.blockersCount,
    staleness: stalenessFootnotes,
  });

  const summary = formatCanIDeployResponse(t, {
    decision,
    status: verdict.status,
    executiveSummary: verdict.executiveSummary,
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
    reviewInProgress: staleness.reviewInProgress,
    reviewFailed: staleness.reviewFailed,
    latestReviewId: latestReview?.id ?? null,
    latestReviewStatus: latestReview?.status ?? null,
    deploymentRecommendation,
    reportUrl: buildProjectReportUrl(project.id),
    summary,
  };
}
