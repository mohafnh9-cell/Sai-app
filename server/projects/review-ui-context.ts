import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductionReviewState } from "@/lib/review/production-review-state";
import { getProductionReviewState } from "@/server/review-cancel/get-production-review-state";
import { getCurrentProductionVerdict } from "@/server/production-verdict/service";
import { getRepositorySyncStatus } from "@/server/repository-sync/get-repository-sync-status";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { refreshGitHubHeadForProject } from "@/server/repository-sync/refresh-github-head";
import { commitsMatch } from "@/lib/repository-sync/commits-match";

export type ProjectReviewUiContext = {
  githubConnected: boolean;
  githubNeedsReconnect: boolean;
  hasVerdict: boolean;
  reviewedCommitSha: string | null;
  latestCommitSha: string | null;
  githubHeadSha: string | null;
  repositoryOutOfSync: boolean;
  isStale: boolean;
  freshnessUnknown: boolean;
  activeScan: {
    id: string;
    scanJobId: string | null;
    scanJobStatus: string | null;
    status: string;
    progress: number | null;
    progressMessage: string | null;
    commitSha: string | null;
  } | null;
  productionReviewState: ProductionReviewState;
};

export async function getProjectReviewUiContext(
  supabase: SupabaseClient,
  projectId: string
): Promise<ProjectReviewUiContext | null> {
  const { data: project } = await supabase
    .from("projects")
    .select("id, github_repo, github_repository_id, organization_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) return null;

  let admin: ReturnType<typeof createAdminClient> | null = null;
  try {
    admin = createAdminClient();
  } catch {
    admin = null;
  }

  if (admin && project.organization_id && project.github_repo) {
    await refreshGitHubHeadForProject(admin, {
      organizationId: project.organization_id as string,
      projectId,
      githubRepo: project.github_repo as string,
      githubRepositoryId: (project.github_repository_id as number | null) ?? null,
    }).catch(() => undefined);
  }

  const [syncStatus, currentVerdict] = await Promise.all([
    getRepositorySyncStatus(supabase, projectId),
    admin ? getCurrentProductionVerdict(admin, projectId) : Promise.resolve(null),
  ]);

  let activeScan: ProjectReviewUiContext["activeScan"] = null;
  let productionReviewState: ProductionReviewState = {
    hasActiveReview: false,
    scanId: null,
    scanJobId: null,
    status: "idle",
    isCancellable: false,
    commitSha: null,
    createdAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    failureMessage: null,
  };

  if (admin && project.organization_id) {
    productionReviewState = await getProductionReviewState(admin, {
      organizationId: project.organization_id as string,
      projectId,
      recoverStale: true,
    });

    if (productionReviewState.scanId && productionReviewState.hasActiveReview) {
      const { data: scanRow } = await admin
        .from("scans")
        .select("progress, progress_message")
        .eq("id", productionReviewState.scanId)
        .maybeSingle();
      activeScan = {
        id: productionReviewState.scanId,
        scanJobId: productionReviewState.scanJobId,
        scanJobStatus: productionReviewState.hasActiveReview ? "running" : null,
        status: productionReviewState.status === "queued" ? "queued" : "scanning",
        progress: (scanRow?.progress as number | null) ?? null,
        progressMessage: (scanRow?.progress_message as string | null) ?? null,
        commitSha: productionReviewState.commitSha,
      };
    }
  }

  const latestCommitSha = syncStatus?.commitSha ?? null;
  const githubHeadSha = latestCommitSha;
  const reviewedCommitSha = currentVerdict?.commitSha ?? null;
  const githubConnected = Boolean(project.github_repo);
  const githubNeedsReconnect =
    !githubConnected ||
    syncStatus?.connectionStatus === "disconnected" ||
    syncStatus?.errorCode === "invalid_github_connection" ||
    syncStatus?.errorCode === "repository_disconnected";

  const freshnessUnknown =
    githubConnected && Boolean(reviewedCommitSha) && !latestCommitSha && !githubNeedsReconnect;

  const isStale =
    Boolean(reviewedCommitSha) &&
    Boolean(latestCommitSha) &&
    !commitsMatch(reviewedCommitSha, latestCommitSha);

  const analyzedForSync =
    productionReviewState.commitSha ?? reviewedCommitSha;
  const repositoryOutOfSync =
    Boolean(githubHeadSha) &&
    Boolean(analyzedForSync) &&
    !commitsMatch(githubHeadSha, analyzedForSync);

  return {
    githubConnected,
    githubNeedsReconnect,
    hasVerdict: Boolean(currentVerdict),
    reviewedCommitSha,
    latestCommitSha,
    githubHeadSha,
    repositoryOutOfSync,
    isStale,
    freshnessUnknown,
    activeScan,
    productionReviewState,
  };
}
