import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedPushDetection } from "@/brain/repository-sync";
import {
  isActiveReviewScanStatus,
  mapScanStatusToReviewStatus,
  validateCommitForReview,
  type AutomaticReviewPanelView,
} from "@/brain/automatic-review";
import { buildRepositoryStatusView } from "@/brain/repository-sync";
import { getWorkspaceGitHubConnectionView } from "@/server/github/workspace-connection-service";
import { getProductionVerdictByScan } from "@/server/production-verdict/service";

type LatestAutomaticReviewRow = {
  id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  failed_at: string | null;
  review_type: string;
};

export async function getAutomaticReviewPanelView(
  supabase: SupabaseClient,
  projectId: string
): Promise<AutomaticReviewPanelView | null> {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, organization_id, github_repo, github_repository_id, webhook_enabled")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError || !project) return null;

  const [{ data: webhookRow }, { data: latestReview }] = await Promise.all([
    supabase
      .from("github_webhooks")
      .select("active")
      .eq("project_id", projectId)
      .maybeSingle(),
    supabase
      .from("scans")
      .select("id, status, created_at, completed_at, failed_at, review_type")
      .eq("repository_id", projectId)
      .eq("review_type", "automatic")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  let hasOrganizationToken = true;
  if (project.github_repo) {
    const connection = await getWorkspaceGitHubConnectionView(supabase, project.organization_id);
    hasOrganizationToken = connection.status === "connected";
  }

  const connection = buildRepositoryStatusView({
    githubRepo: project.github_repo,
    githubRepositoryId: project.github_repository_id,
    webhookEnabled: project.webhook_enabled,
    webhookActive: webhookRow?.active ?? null,
    hasWebhookRegistration: Boolean(webhookRow),
    hasOrganizationToken,
    lastError: null,
    detectedAt: null,
    branch: null,
    commitSha: null,
    commitMessage: null,
    pushedAt: null,
  });

  const enabled =
    connection.connectionStatus === "connected" &&
    Boolean(project.github_repo);

  const review = latestReview as LatestAutomaticReviewRow | null;
  const reviewStatus = review
    ? mapScanStatusToReviewStatus(review.status)
    : null;
  const latestReviewAt =
    review?.completed_at ?? review?.failed_at ?? review?.created_at ?? null;

  let errorCode = null as AutomaticReviewPanelView["errorCode"];
  let verdictUpdated: boolean | null = null;

  if (connection.errorCode === "repository_disconnected") {
    errorCode = "repository_disconnected";
  } else if (reviewStatus === "failed") {
    errorCode = "review_failed";
  } else if (review && reviewStatus === "completed") {
    const verdict = await getProductionVerdictByScan(
      supabase,
      project.organization_id,
      review.id
    );
    verdictUpdated = Boolean(verdict);
    if (!verdict) {
      errorCode = "review_failed";
    }
  }

  return {
    enabled,
    reviewType: review ? "automatic" : null,
    status: reviewStatus,
    latestReviewAt,
    verdictUpdated,
    errorCode,
  };
}

export async function hasCompletedAutomaticReviewForCommit(
  admin: SupabaseClient,
  projectId: string,
  commitSha: string
): Promise<boolean> {
  const { data } = await admin
    .from("scans")
    .select("id")
    .eq("repository_id", projectId)
    .eq("review_type", "automatic")
    .eq("commit_sha", commitSha)
    .eq("status", "completed")
    .maybeSingle();

  return Boolean(data);
}

export async function hasActiveRepositoryReview(
  admin: SupabaseClient,
  projectId: string
): Promise<boolean> {
  const { data } = await admin
    .from("scans")
    .select("status")
    .eq("repository_id", projectId)
    .in("status", [
      "queued",
      "fetching_repository",
      "indexing",
      "scanning",
      "calculating_score",
    ])
    .limit(1)
    .maybeSingle();

  return Boolean(data && isActiveReviewScanStatus(data.status));
}

export function buildCommitValidationInput(input: {
  detection: ParsedPushDetection;
  githubRepositoryId: number | null;
}): Parameters<typeof validateCommitForReview>[0] {
  return {
    commitSha: input.detection.commitSha,
    branch: input.detection.branch,
    githubRepositoryId: input.githubRepositoryId,
    expectedRepositoryId: input.githubRepositoryId,
    pushedAt: input.detection.pushedAt,
  };
}
