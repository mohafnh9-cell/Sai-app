import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveProductionReviewForProject } from "@/server/review-cancel/get-active-production-review";
import { isProductionReviewCancellable } from "@/lib/review/production-review-cancellable";
import { getCurrentProductionVerdict } from "@/server/production-verdict/service";
import { getRepositorySyncStatus } from "@/server/repository-sync/get-repository-sync-status";
import { createAdminClient } from "@/server/security-scanner/admin-client";

export type ProjectReviewUiContext = {
  githubConnected: boolean;
  githubNeedsReconnect: boolean;
  hasVerdict: boolean;
  reviewedCommitSha: string | null;
  latestCommitSha: string | null;
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
};

export async function getProjectReviewUiContext(
  supabase: SupabaseClient,
  projectId: string
): Promise<ProjectReviewUiContext | null> {
  const { data: project } = await supabase
    .from("projects")
    .select("id, github_repo, organization_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) return null;

  let admin: ReturnType<typeof createAdminClient> | null = null;
  try {
    admin = createAdminClient();
  } catch {
    admin = null;
  }

  const [syncStatus, currentVerdict, scanStateResult] = await Promise.all([
    getRepositorySyncStatus(supabase, projectId),
    admin ? getCurrentProductionVerdict(admin, projectId) : Promise.resolve(null),
    admin
      ? admin
          .from("repository_scan_state")
          .select("active_scan_id")
          .eq("repository_id", projectId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  let activeScan: ProjectReviewUiContext["activeScan"] = null;
  if (admin && project.organization_id) {
    const activeReview = await getActiveProductionReviewForProject(admin, {
      organizationId: project.organization_id as string,
      projectId,
    });
    if (activeReview) {
      const { data: scanRow } = await admin
        .from("scans")
        .select("progress, progress_message, commit_sha")
        .eq("id", activeReview.scanId)
        .maybeSingle();
      activeScan = {
        id: activeReview.scanId,
        scanJobId: activeReview.scanJobId,
        scanJobStatus: activeReview.scanJobStatus,
        status: activeReview.scanStatus,
        progress: (scanRow?.progress as number | null) ?? null,
        progressMessage: (scanRow?.progress_message as string | null) ?? null,
        commitSha: (scanRow?.commit_sha as string | null) ?? null,
      };
    } else {
      const activeScanId = scanStateResult.data?.active_scan_id as string | null | undefined;
      if (activeScanId) {
        const { data: scanRow } = await admin
          .from("scans")
          .select("id, status, progress, progress_message, commit_sha")
          .eq("id", activeScanId)
          .maybeSingle();
        if (
          scanRow &&
          isProductionReviewCancellable({ scanStatus: scanRow.status as string })
        ) {
          activeScan = {
            id: scanRow.id as string,
            scanJobId: null,
            scanJobStatus: null,
            status: scanRow.status as string,
            progress: (scanRow.progress as number | null) ?? null,
            progressMessage: (scanRow.progress_message as string | null) ?? null,
            commitSha: (scanRow.commit_sha as string | null) ?? null,
          };
        }
      }
    }
  }

  const latestCommitSha = syncStatus?.commitSha ?? null;
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
    reviewedCommitSha !== latestCommitSha;

  return {
    githubConnected,
    githubNeedsReconnect,
    hasVerdict: Boolean(currentVerdict),
    reviewedCommitSha,
    latestCommitSha,
    isStale,
    freshnessUnknown,
    activeScan,
  };
}
