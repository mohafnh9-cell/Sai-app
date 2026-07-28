import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isActiveReviewScanStatus } from "@/brain/automatic-review/review-status";
import { commitsMatch } from "@/lib/repository-sync/commits-match";
import { markScanJobCancelled } from "@/server/jobs/scan-job-store";

const ACTIVE_SCAN_STATUSES = [
  "queued",
  "fetching_repository",
  "indexing",
  "scanning",
  "calculating_score",
] as const;

export const COMMIT_SUPERSEDED_CODE = "COMMIT_SUPERSEDED_BY_REMOTE_HEAD";

export type ReleaseActiveReviewForNewHeadResult = {
  releasedScanIds: string[];
};

/**
 * Clears active reviews that target an older commit so a new Production Review
 * can bind to the current GitHub HEAD.
 */
export async function releaseActiveReviewForNewHead(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    targetCommitSha: string;
    targetBranch?: string | null;
  }
): Promise<ReleaseActiveReviewForNewHeadResult> {
  const { data: activeScans } = await admin
    .from("scans")
    .select("id, status, commit_sha, branch")
    .eq("repository_id", input.projectId)
    .in("status", [...ACTIVE_SCAN_STATUSES]);

  const releasedScanIds: string[] = [];
  const now = new Date().toISOString();

  for (const scan of activeScans ?? []) {
    const scanCommit = (scan.commit_sha as string | null) ?? null;
    if (scanCommit && commitsMatch(scanCommit, input.targetCommitSha)) {
      continue;
    }

    const scanId = scan.id as string;
    const { data: updated } = await admin
      .from("scans")
      .update({
        status: "failed",
        failed_at: now,
        error_code: COMMIT_SUPERSEDED_CODE,
        error_message: "Review superseded because GitHub has a newer commit",
        progress_message: "Review stopped — repository moved to a newer commit",
      })
      .eq("id", scanId)
      .in("status", [...ACTIVE_SCAN_STATUSES])
      .select("id")
      .maybeSingle();

    if (!updated) continue;

    releasedScanIds.push(scanId);

    const { data: job } = await admin
      .from("scan_jobs")
      .select("id")
      .eq("scan_id", scanId)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (job?.id) {
      await markScanJobCancelled(admin, job.id as string, {
        failureCode: COMMIT_SUPERSEDED_CODE,
        failureMessage: "Review superseded by newer GitHub commit",
      }).catch(() => undefined);
    }

    await admin
      .from("repository_scan_state")
      .update({ active_scan_id: null })
      .eq("repository_id", input.projectId)
      .eq("active_scan_id", scanId);

    console.info({
      component: "release-active-review-for-new-head",
      event: "active_review_released",
      projectId: input.projectId,
      scanId,
      previousCommitSha: scanCommit,
      targetCommitSha: input.targetCommitSha,
      targetBranch: input.targetBranch ?? null,
    });
  }

  return { releasedScanIds };
}

export async function loadActiveReviewCommitSha(
  admin: SupabaseClient,
  projectId: string
): Promise<string | null> {
  const { data } = await admin
    .from("scans")
    .select("commit_sha, status")
    .eq("repository_id", projectId)
    .in("status", [...ACTIVE_SCAN_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data || !isActiveReviewScanStatus(data.status as string)) {
    return null;
  }
  return (data.commit_sha as string | null) ?? null;
}
