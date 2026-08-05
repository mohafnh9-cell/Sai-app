import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductionReviewState } from "@/lib/review/production-review-state";
import { getProductionReviewState } from "@/server/review-cancel/get-production-review-state";
import { getCurrentProductionVerdict } from "@/server/production-verdict/service";
import { getRepositorySyncStatus } from "@/server/repository-sync/get-repository-sync-status";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { refreshGitHubHeadForProject } from "@/server/repository-sync/refresh-github-head";
import { commitsMatch } from "@/lib/repository-sync/commits-match";
import { computeGithubSyncDisplay } from "@/lib/repository-sync/compute-sync-display";

export type ProjectReviewUiContext = {
  githubConnected: boolean;
  githubNeedsReconnect: boolean;
  hasVerdict: boolean;
  /** True when a completed analysis exists (verdict or completed scan), not verdict-only. */
  hasCompletedAnalysis: boolean;
  /** ISO timestamp for "Último análisis" — verdict time or latest completed scan. */
  lastAnalysisAt: string | null;
  reviewedCommitSha: string | null;
  latestCommitSha: string | null;
  githubHeadSha: string | null;
  repositoryOutOfSync: boolean;
  syncInProgress: boolean;
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

type ReviewUiContextOptions = {
  analysisRunId?: string | null;
  analysisRuns?: Array<{
    runId: string;
    status: string;
    completedAt: string | null;
  }>;
  scopedVerdictGeneratedAt?: string | null;
};

export async function getProjectReviewUiContext(
  supabase: SupabaseClient,
  projectId: string,
  options?: ReviewUiContextOptions
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

  const syncView = computeGithubSyncDisplay({
    githubHeadSha,
    lastVerdictCommitSha: reviewedCommitSha,
    activeReviewCommitSha: productionReviewState.commitSha,
    hasActiveReview: productionReviewState.hasActiveReview,
  });

  const runs = options?.analysisRuns ?? [];
  const scopedRun = options?.analysisRunId
    ? runs.find((run) => run.runId === options.analysisRunId)
    : runs[0] ?? null;
  const latestCompletedRun =
    runs.find((run) => run.status === "completed") ??
    (scopedRun?.status === "completed" ? scopedRun : null);

  const hasCompletedAnalysis =
    Boolean(currentVerdict) ||
    productionReviewState.status === "completed" ||
    runs.some((run) => run.status === "completed");

  const lastAnalysisAt =
    options?.scopedVerdictGeneratedAt ??
    (scopedRun?.status === "completed" ? scopedRun.completedAt : null) ??
    latestCompletedRun?.completedAt ??
    productionReviewState.completedAt ??
    currentVerdict?.generatedAt ??
    null;

  return {
    githubConnected,
    githubNeedsReconnect,
    hasVerdict: Boolean(currentVerdict),
    hasCompletedAnalysis,
    lastAnalysisAt,
    reviewedCommitSha,
    latestCommitSha,
    githubHeadSha,
    repositoryOutOfSync: syncView.repositoryOutOfSync,
    syncInProgress: syncView.syncInProgress,
    isStale,
    freshnessUnknown,
    activeScan,
    productionReviewState,
  };
}
