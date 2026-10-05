import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The single, branch-aware definition of "the previous completed scan" for a
 * scan: the baseline an incremental scan inherits findings and coverage from,
 * and the reference a verdict's score / blocker deltas are computed against.
 *
 * Resolution order (repository + branch):
 *   1. the most recent completed scan of the SAME branch;
 *   2. only when the scan is on a non-default branch and has no same-branch
 *      scan: the most recent completed scan of the DEFAULT branch (a pull
 *      request's unchanged files are the default branch's files, so that is
 *      the correct inheritance source for its first scan);
 *   3. never another feature branch. The most recent repository scan is not a
 *      valid baseline merely because it is the most recent.
 *
 * A scan without a branch (legacy / manual) is treated as the default branch.
 */
export type PreviousScanScope = {
  projectId: string;
  /** Branch of the scan being processed. */
  branch: string | null | undefined;
  excludeScanId: string;
};

type Row = Record<string, unknown>;

async function loadDefaultBranch(admin: SupabaseClient, projectId: string): Promise<string | null> {
  const { data } = await admin
    .from("projects")
    .select("github_default_branch")
    .eq("id", projectId)
    .maybeSingle();
  return ((data as { github_default_branch?: string | null } | null)?.github_default_branch ?? null) || null;
}

async function completedScans(
  admin: SupabaseClient,
  scope: PreviousScanScope,
  columns: string,
  branchFilter: { eq: string } | { isNull: true },
  limit: number
): Promise<Row[]> {
  let query = admin
    .from("scans")
    .select(columns)
    .eq("project_id", scope.projectId)
    .eq("status", "completed")
    .neq("id", scope.excludeScanId);
  query = "eq" in branchFilter ? query.eq("branch", branchFilter.eq) : query.is("branch", null);
  const { data } = await query.order("completed_at", { ascending: false }).limit(limit);
  return (data ?? []) as unknown as Row[];
}

/**
 * Candidate previous scans, best first (same branch before the default-branch
 * fallback). Callers take `[0]` or the first row satisfying their own rule.
 * `columns` must include whatever the caller reads; `id` is always added.
 */
export async function listPreviousCompletedScans(
  admin: SupabaseClient,
  scope: PreviousScanScope,
  columns: string,
  limit = 1
): Promise<Row[]> {
  const select = columns.split(",").map((c) => c.trim()).includes("id") ? columns : `id, ${columns}`;
  const defaultBranch = await loadDefaultBranch(admin, scope.projectId);
  const onDefault = !scope.branch || (defaultBranch != null && scope.branch === defaultBranch);

  const sources: Array<{ eq: string } | { isNull: true }> = [];
  if (onDefault) {
    if (defaultBranch) sources.push({ eq: defaultBranch });
    sources.push({ isNull: true });
  } else {
    sources.push({ eq: scope.branch as string });
    // Explicit fallback: the default branch only, and only if it is known.
    if (defaultBranch) sources.push({ eq: defaultBranch }, { isNull: true });
  }

  const rows: Row[] = [];
  for (const source of sources) {
    if (rows.length >= limit) break;
    rows.push(...(await completedScans(admin, scope, select, source, limit - rows.length)));
  }
  return rows.slice(0, limit);
}

export async function findPreviousCompletedScan(
  admin: SupabaseClient,
  scope: PreviousScanScope,
  columns: string
): Promise<Row | null> {
  return (await listPreviousCompletedScans(admin, scope, columns, 1))[0] ?? null;
}
