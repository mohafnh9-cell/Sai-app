import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { commitsMatch } from "@/lib/repository-sync/commits-match";

const ACTIVE_SCAN_STATUSES = [
  "queued",
  "fetching_repository",
  "indexing",
  "scanning",
  "calculating_score",
  "cancelling",
] as const;

export type ScanByShaResult =
  | { state: "none" }
  | { state: "active"; scan: Record<string, unknown> }
  | { state: "completed"; scan: Record<string, unknown> }
  | { state: "failed"; scan: Record<string, unknown> };

/**
 * Find the best matching scan for an exact commit SHA across all review types.
 * CI enforcement must not depend on review_type — webhooks and manual paths share SHA identity.
 */
export async function findScanByCommitSha(
  admin: SupabaseClient,
  input: { projectId: string; commitSha: string }
): Promise<ScanByShaResult> {
  const { data: activeScans } = await admin
    .from("scans")
    .select(
      "id, status, commit_sha, review_type, trigger_type, progress, progress_message, created_at, completed_at, failed_at"
    )
    .eq("repository_id", input.projectId)
    .in("status", [...ACTIVE_SCAN_STATUSES])
    .order("created_at", { ascending: false })
    .limit(10);

  for (const scan of activeScans ?? []) {
    const sha = (scan.commit_sha as string | null) ?? null;
    if (sha && commitsMatch(sha, input.commitSha)) {
      return { state: "active", scan: scan as Record<string, unknown> };
    }
  }

  const { data: recentScans } = await admin
    .from("scans")
    .select(
      "id, status, commit_sha, review_type, trigger_type, progress, progress_message, created_at, completed_at, failed_at"
    )
    .eq("repository_id", input.projectId)
    .in("status", ["completed", "failed", "cancelled"])
    .order("created_at", { ascending: false })
    .limit(25);

  for (const scan of recentScans ?? []) {
    const sha = (scan.commit_sha as string | null) ?? null;
    if (!sha || !commitsMatch(sha, input.commitSha)) continue;
    if (scan.status === "completed") {
      return { state: "completed", scan: scan as Record<string, unknown> };
    }
    if (scan.status === "failed") {
      return { state: "failed", scan: scan as Record<string, unknown> };
    }
  }

  return { state: "none" };
}
