import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { commitsMatch } from "@/lib/repository-sync/commits-match";
import { getProductionReviewState } from "@/server/review-cancel/get-production-review-state";
import { getCurrentProductionVerdict } from "@/server/production-verdict/service";
import { refreshGitHubHeadForProject } from "@/server/repository-sync/refresh-github-head";
import { isProductionReviewCancellable } from "@/lib/review/production-review-cancellable";
import { parseGitHubRepository } from "@/lib/github/repository-reference";

export type ProductionReviewUiContract = {
  github: {
    branch: string | null;
    headCommitSha: string | null;
  };
  latestCompletedReview: {
    scanId: string;
    commitSha: string;
    completedAt: string | null;
  } | null;
  activeReview: {
    scanId: string;
    scanJobId: string;
    commitSha: string | null;
    status: string;
  } | null;
  repositoryOutOfSync: boolean;
  reviewInProgress: boolean;
  canStartReview: boolean;
  canCancelReview: boolean;
  infrastructureError: {
    code: string;
    message: string;
  } | null;
};

export async function buildProductionReviewUiContract(
  admin: SupabaseClient,
  input: { organizationId: string; projectId: string }
): Promise<ProductionReviewUiContract | null> {
  const { data: project } = await admin
    .from("projects")
    .select("github_repo, github_repository_id, github_default_branch")
    .eq("id", input.projectId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  if (!project?.github_repo) return null;

  const ref = parseGitHubRepository(project.github_repo as string);
  const head = await refreshGitHubHeadForProject(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    githubRepo: project.github_repo as string,
    githubRepositoryId: (project.github_repository_id as number | null) ?? null,
    branch: (project.github_default_branch as string | null) ?? null,
  }).catch(() => null);

  const state = await getProductionReviewState(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
  });

  const verdict = await getCurrentProductionVerdict(admin, input.projectId);

  let activeJobStatus: string | null = null;
  if (state.scanJobId) {
    const { data: job } = await admin
      .from("scan_jobs")
      .select("status")
      .eq("id", state.scanJobId)
      .maybeSingle();
    activeJobStatus = (job?.status as string | null) ?? null;
  }

  const reviewInProgress =
    Boolean(state.scanJobId) &&
    Boolean(state.scanId) &&
    state.hasActiveReview &&
    (activeJobStatus === "queued" || activeJobStatus === "running");

  const latestCompletedReview =
    verdict?.commitSha && verdict.scanId
      ? {
          scanId: verdict.scanId,
          commitSha: verdict.commitSha,
          completedAt: verdict.generatedAt ?? null,
        }
      : null;

  const headSha = head?.commitSha ?? null;
  const completedSha = latestCompletedReview?.commitSha ?? null;
  const repositoryOutOfSync =
    Boolean(headSha) &&
    Boolean(completedSha) &&
    !commitsMatch(headSha, completedSha) &&
    !reviewInProgress;

  const activeReview =
    state.scanId && state.hasActiveReview
      ? {
          scanId: state.scanId,
          scanJobId: state.scanJobId ?? "",
          commitSha: state.commitSha,
          status: state.status,
        }
      : null;

  const canCancelReview =
    reviewInProgress &&
    Boolean(state.scanJobId) &&
    isProductionReviewCancellable({
      scanStatus: state.status,
      scanJobStatus: activeJobStatus,
    });

  return {
    github: {
      branch: head?.branch ?? (project.github_default_branch as string | null),
      headCommitSha: headSha,
    },
    latestCompletedReview,
    activeReview: activeReview && reviewInProgress ? activeReview : null,
    repositoryOutOfSync,
    reviewInProgress,
    canStartReview: !reviewInProgress,
    canCancelReview,
    infrastructureError: null,
  };
}
