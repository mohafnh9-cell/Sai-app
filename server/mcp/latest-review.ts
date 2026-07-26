import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type LatestReviewSummary = {
  id: string;
  status: string;
  commitSha: string | null;
  errorCode: string | null;
  createdAt: string;
} | null;

/**
 * ADR-001: retrieves (never calculates) the most recently created review of
 * any trigger/review type for this project — the same "latest activity"
 * signal can_i_deploy exposes as latestReviewId / latestReviewStatus.
 */
export async function getLatestReviewSummary(
  admin: SupabaseClient,
  projectId: string
): Promise<LatestReviewSummary> {
  const { data } = await admin
    .from("scans")
    .select("id, status, commit_sha, error_code, created_at")
    .eq("repository_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    status: data.status as string,
    commitSha: (data.commit_sha as string | null) ?? null,
    errorCode: (data.error_code as string | null) ?? null,
    createdAt: data.created_at as string,
  };
}
