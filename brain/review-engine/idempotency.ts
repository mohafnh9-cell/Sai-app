import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { commitsMatch } from "@/lib/repository-sync/commits-match";
import { isActiveReviewScanStatus } from "@/brain/automatic-review/review-status";

const ACTIVE_SCAN_STATUSES = [
  "queued",
  "fetching_repository",
  "indexing",
  "scanning",
  "calculating_score",
  "cancelling",
] as const;

export type ReviewIdempotencyLookup = {
  action: "create_new";
} | {
  action: "resume_active";
  scan: Record<string, unknown>;
} | {
  action: "reuse_completed";
  scan: Record<string, unknown>;
};

export async function resolveReviewIdempotency(
  admin: SupabaseClient,
  input: {
    projectId: string;
    commitSha: string;
    reviewType?: string | null;
  }
): Promise<ReviewIdempotencyLookup> {
  const reviewType = input.reviewType ?? "manual";

  const { data: activeScans } = await admin
    .from("scans")
    .select("id, status, commit_sha, review_type, progress, progress_message, created_at, completed_at")
    .eq("repository_id", input.projectId)
    .in("status", [...ACTIVE_SCAN_STATUSES])
    .order("created_at", { ascending: false })
    .limit(5);

  for (const scan of activeScans ?? []) {
    const sha = (scan.commit_sha as string | null) ?? null;
    const type = (scan.review_type as string | null) ?? "manual";
    if (type === reviewType && sha && commitsMatch(sha, input.commitSha)) {
      if (isActiveReviewScanStatus(String(scan.status))) {
        return { action: "resume_active", scan: scan as Record<string, unknown> };
      }
    }
  }

  const { data: completed } = await admin
    .from("scans")
    .select("id, status, commit_sha, review_type, progress, progress_message, created_at, completed_at, security_score, findings_count")
    .eq("repository_id", input.projectId)
    .eq("status", "completed")
    .eq("review_type", reviewType)
    .order("completed_at", { ascending: false })
    .limit(10);

  for (const scan of completed ?? []) {
    const sha = (scan.commit_sha as string | null) ?? null;
    if (sha && commitsMatch(sha, input.commitSha)) {
      return { action: "reuse_completed", scan: scan as Record<string, unknown> };
    }
  }

  return { action: "create_new" };
}
