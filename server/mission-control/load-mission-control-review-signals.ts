import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductionReviewState } from "@/lib/review/production-review-state";
import { getProductionReviewState } from "@/server/review-cancel/get-production-review-state";
import { getCurrentProductionVerdict } from "@/server/production-verdict/service";
import { getRepositorySyncStatus } from "@/server/repository-sync/get-repository-sync-status";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { refreshGitHubHeadForProject } from "@/server/repository-sync/refresh-github-head";
import { computeGithubSyncDisplay } from "@/lib/repository-sync/compute-sync-display";
import { commitsMatch } from "@/lib/repository-sync/commits-match";

export type MissionControlReviewSignals = {
  productionReviewState: ProductionReviewState;
  progress: number | null;
  progressMessage: string | null;
  repositoryConnected: boolean;
  repositoryOutOfSync: boolean;
  githubNeedsReconnect: boolean;
  currentCommitSha: string | null;
  isVerdictStale: boolean;
};

const IDLE_REVIEW_STATE: ProductionReviewState = {
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

export async function loadMissionControlReviewSignals(
  supabase: SupabaseClient,
  input: {
    projectId: string;
    organizationId: string;
    admin: SupabaseClient | null;
  }
): Promise<MissionControlReviewSignals> {
  const { projectId, organizationId, admin } = input;

  const { data: project } = await supabase
    .from("projects")
    .select("id, github_repo, github_repository_id, organization_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) {
    return {
      productionReviewState: IDLE_REVIEW_STATE,
      progress: null,
      progressMessage: null,
      repositoryConnected: false,
      repositoryOutOfSync: false,
      githubNeedsReconnect: true,
      currentCommitSha: null,
      isVerdictStale: false,
    };
  }

  let adminClient = admin;
  if (!adminClient) {
    try {
      adminClient = createAdminClient();
    } catch {
      adminClient = null;
    }
  }

  if (adminClient && project.organization_id && project.github_repo) {
    await refreshGitHubHeadForProject(adminClient, {
      organizationId: project.organization_id as string,
      projectId,
      githubRepo: project.github_repo as string,
      githubRepositoryId: (project.github_repository_id as number | null) ?? null,
    }).catch(() => undefined);
  }

  const [syncStatus, currentVerdict] = await Promise.all([
    getRepositorySyncStatus(supabase, projectId),
    adminClient ? getCurrentProductionVerdict(adminClient, projectId) : Promise.resolve(null),
  ]);

  let productionReviewState = IDLE_REVIEW_STATE;
  let progress: number | null = null;
  let progressMessage: string | null = null;

  if (adminClient && project.organization_id) {
    productionReviewState = await getProductionReviewState(adminClient, {
      organizationId: project.organization_id as string,
      projectId,
      recoverStale: true,
    });

    if (productionReviewState.scanId && productionReviewState.hasActiveReview) {
      const { data: scanRow } = await adminClient
        .from("scans")
        .select("progress, progress_message")
        .eq("id", productionReviewState.scanId)
        .maybeSingle();
      progress = (scanRow?.progress as number | null) ?? null;
      progressMessage = (scanRow?.progress_message as string | null) ?? null;
    }
  }

  const githubHeadSha = syncStatus?.commitSha ?? null;
  const reviewedCommitSha = currentVerdict?.commitSha ?? null;
  const githubConnected = Boolean(project.github_repo);
  const githubNeedsReconnect =
    !githubConnected ||
    syncStatus?.connectionStatus === "disconnected" ||
    syncStatus?.errorCode === "invalid_github_connection" ||
    syncStatus?.errorCode === "repository_disconnected";

  const isVerdictStale =
    Boolean(reviewedCommitSha) &&
    Boolean(githubHeadSha) &&
    !commitsMatch(reviewedCommitSha, githubHeadSha);

  const syncView = computeGithubSyncDisplay({
    githubHeadSha,
    lastVerdictCommitSha: reviewedCommitSha,
    activeReviewCommitSha: productionReviewState.commitSha,
    hasActiveReview: productionReviewState.hasActiveReview,
  });

  return {
    productionReviewState,
    progress,
    progressMessage,
    repositoryConnected: githubConnected,
    repositoryOutOfSync: syncView.repositoryOutOfSync,
    githubNeedsReconnect,
    currentCommitSha:
      productionReviewState.commitSha ?? githubHeadSha ?? null,
    isVerdictStale,
  };
}
