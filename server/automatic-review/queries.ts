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

const ACTIVE_REVIEW_STATUSES = [
  "queued",
  "fetching_repository",
  "indexing",
  "scanning",
  "calculating_score",
];

/**
 * The active review of ONE branch scope. `branch` omitted/undefined means the
 * project's default branch (the production decision scope); null is treated as
 * the default branch too (branchless GitHub scans are default-branch scans).
 * Reviews of other branches are never returned: a feature review is not the
 * default branch's active review, and vice versa.
 */
export async function loadActiveReviewForBranch(
  admin: SupabaseClient,
  projectId: string,
  branch?: string | null
): Promise<{ id: string; status: string; branch: string | null } | null> {
  const [{ data: project }, { data: scans }] = await Promise.all([
    admin.from("projects").select("github_default_branch").eq("id", projectId).maybeSingle(),
    admin
      .from("scans")
      .select("id, status, branch, created_at")
      .eq("repository_id", projectId)
      .in("status", ACTIVE_REVIEW_STATUSES)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const defaultBranch =
    (project as { github_default_branch?: string | null } | null)?.github_default_branch ?? null;
  const scope = branch ?? defaultBranch;
  const match = (scans ?? []).find((row) => {
    const rowBranch = (row as { branch?: string | null }).branch ?? null;
    // A branchless scan with an unknown default branch cannot be scoped: it is
    // conservatively treated as belonging to every scope (legacy behaviour).
    if (!rowBranch && !defaultBranch) return true;
    return scope === (rowBranch ?? defaultBranch);
  });
  if (!match || !isActiveReviewScanStatus((match as { status: string }).status)) return null;
  return {
    id: (match as { id: string }).id,
    status: (match as { status: string }).status,
    branch: ((match as { branch?: string | null }).branch ?? null) as string | null,
  };
}

export async function hasActiveRepositoryReview(
  admin: SupabaseClient,
  projectId: string,
  branch?: string | null
): Promise<boolean> {
  return Boolean(await loadActiveReviewForBranch(admin, projectId, branch));
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
