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
  // Only the default branch's reviews describe "the current deployment
  // decision": a review of a feature branch must never become the "latest
  // review" (it would hold the default branch's answer in "awaiting verdict"
  // forever, because a non-default scan never becomes the authoritative one).
  const [{ data: project }, { data: recent }] = await Promise.all([
    admin.from("projects").select("github_default_branch").eq("id", projectId).maybeSingle(),
    admin
      .from("scans")
      .select("id, status, commit_sha, error_code, created_at, branch")
      .eq("repository_id", projectId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const defaultBranch =
    (project as { github_default_branch?: string | null } | null)?.github_default_branch ?? null;
  const data = (recent ?? []).find((row) => {
    const branch = (row as { branch?: string | null }).branch ?? null;
    return !defaultBranch || !branch || branch === defaultBranch;
  });
  if (!data) return null;
  return {
    id: data.id as string,
    status: data.status as string,
    commitSha: (data.commit_sha as string | null) ?? null,
    errorCode: (data.error_code as string | null) ?? null,
    createdAt: data.created_at as string,
  };
}
