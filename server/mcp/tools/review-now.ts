import "server-only";

import { McpError } from "../auth";
import type { McpAuthContext } from "../auth";
import type { McpTranslator } from "../i18n";
import { formatReviewNowResponse } from "../personality";
import type { ProjectSelector } from "../project-resolution";
import { resolveMcpProject } from "../project-resolution";
import { isMcpReviewRateLimited } from "@/server/review-now/rate-limit";
import type { TriggerReviewDependencies } from "@/server/review-now/trigger-review";
import { ReviewNowError, triggerProductionReview } from "@/server/review-now/trigger-review";

export type ReviewNowInput = ProjectSelector & {
  commitSha?: string;
  branch?: string;
  reason?: "before_deploy" | "after_fix" | "manual_check";
};

export type ReviewNowStatus = "queued" | "processing" | "already_completed";

export type ReviewNowResult = {
  mode: "production_review_request";
  project: { id: string; name: string; repositoryFullName: string | null };
  reviewId: string | null;
  commitSha: string | null;
  branch: string | null;
  status: ReviewNowStatus;
  createdAt: string;
  duplicate: boolean;
  verdictStatus: string | null;
  score: number | null;
  reviewedCommitSha: string | null;
  nextAction: string;
  summary: string;
};

const ERROR_STATUS: Record<string, number> = {
  repository_disconnected: 422,
  invalid_commit: 422,
  commit_not_found: 404,
  review_creation_failed: 500,
  internal_error: 500,
};

export async function reviewNow(
  ctx: McpAuthContext,
  input: ReviewNowInput,
  t: McpTranslator,
  deps: TriggerReviewDependencies = {}
): Promise<ReviewNowResult> {
  const project = await resolveMcpProject(ctx, input, t);

  if (await isMcpReviewRateLimited(ctx.admin, ctx.organizationId)) {
    throw new McpError(429, "rate_limited", t("errors.rate_limited"));
  }

  const { data: projectRow } = await ctx.admin
    .from("projects")
    .select("github_repo, github_repository_id")
    .eq("id", project.id)
    .maybeSingle();

  let outcome;
  try {
    outcome = await triggerProductionReview(
      ctx.admin,
      {
        organizationId: ctx.organizationId,
        projectId: project.id,
        githubRepo: (projectRow?.github_repo as string | null) ?? null,
        githubRepositoryId: (projectRow?.github_repository_id as number | null) ?? null,
        requestedCommitSha: input.commitSha,
        requestedBranch: input.branch,
      },
      deps
    );
  } catch (error) {
    if (error instanceof ReviewNowError) {
      const status = ERROR_STATUS[error.code] ?? 500;
      const message = t(`errors.${error.code}`) || error.message;
      throw new McpError(status, error.code, message);
    }
    throw error;
  }

  const nextAction = t("reviewNow.queuedNext");

  if (outcome.outcome === "queued") {
    return {
      mode: "production_review_request",
      project,
      reviewId: outcome.reviewId,
      commitSha: outcome.commitSha,
      branch: outcome.branch,
      status: "queued",
      createdAt: outcome.createdAt,
      duplicate: false,
      verdictStatus: null,
      score: null,
      reviewedCommitSha: null,
      nextAction,
      summary: formatReviewNowResponse(t, "queued", project.name),
    };
  }

  if (outcome.outcome === "processing") {
    return {
      mode: "production_review_request",
      project,
      reviewId: outcome.reviewId,
      commitSha: null,
      branch: null,
      status: "processing",
      createdAt: new Date().toISOString(),
      duplicate: true,
      verdictStatus: null,
      score: null,
      reviewedCommitSha: null,
      nextAction,
      summary: formatReviewNowResponse(t, "processing", project.name),
    };
  }

  return {
    mode: "production_review_request",
    project,
    reviewId: outcome.reviewId,
    commitSha: outcome.reviewedCommitSha,
    branch: null,
    status: "already_completed",
    createdAt: new Date().toISOString(),
    duplicate: true,
    verdictStatus: outcome.verdictStatus,
    score: outcome.score,
    reviewedCommitSha: outcome.reviewedCommitSha,
    nextAction: t("reviewNow.alreadyNext"),
    summary: formatReviewNowResponse(t, "already_completed", project.name),
  };
}
