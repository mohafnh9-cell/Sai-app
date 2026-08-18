import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { safeParseProductionVerdict } from "@/brain/production-verdict/schema";
import { getProductionVerdictByScan } from "@/server/production-verdict/service";

export type PullRequestScanView = {
  id: string;
  projectId: string;
  organizationId: string;
  pullRequestNumber: number;
  pullRequestTitle: string | null;
  baseBranch: string | null;
  headBranch: string | null;
  baseCommitSha: string | null;
  headCommitSha: string | null;
  scanId: string | null;
  scanStatus: "pending" | "completed" | "missing";
  checkStatus: "passed" | "failed" | "warning" | "pending" | null;
  verdictStatus: string | null;
  score: number | null;
  blockersCount: number;
  topBlockers: Array<{ title: string; severity: string }>;
  productionVerdict: ProductionVerdictV1 | null;
  githubCheckRunId: number | null;
  source: "pr";
  createdAt: string;
  updatedAt: string;
  stale: boolean;
};

export async function getLatestPullRequestScan(
  admin: SupabaseClient,
  input: { projectId: string; pullRequestNumber: number; headSha?: string | null }
): Promise<PullRequestScanView | null> {
  const { data: row } = input.headSha
    ? await admin
        .from("pull_request_scans")
        .select("*")
        .eq("project_id", input.projectId)
        .eq("pull_request_number", input.pullRequestNumber)
        .eq("head_commit_sha", input.headSha)
        .maybeSingle()
    : await admin
        .from("pull_request_scans")
        .select("*")
        .eq("project_id", input.projectId)
        .eq("pull_request_number", input.pullRequestNumber)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

  if (!row) return null;

  let productionVerdict: ProductionVerdictV1 | null = null;
  if (row.production_verdict_id) {
    const { data: verdictRow } = await admin
      .from("production_verdicts")
      .select("verdict")
      .eq("id", row.production_verdict_id)
      .maybeSingle();
    productionVerdict = verdictRow?.verdict
      ? safeParseProductionVerdict(verdictRow.verdict)
      : null;
  } else if (row.scan_id) {
    productionVerdict = await getProductionVerdictByScan(
      admin,
      row.organization_id as string,
      row.scan_id
    );
  }

  let scanStatus: PullRequestScanView["scanStatus"] = "missing";
  if (row.scan_id) {
    const { data: scan } = await admin
      .from("scans")
      .select("status")
      .eq("id", row.scan_id)
      .maybeSingle();
    if (scan?.status === "completed") scanStatus = "completed";
    else if (scan) scanStatus = "pending";
  }

  const topBlockers =
    productionVerdict?.topPriorities.slice(0, 5).map((priority) => ({
      title: priority.title,
      severity: priority.severity,
    })) ?? [];

  return {
    id: row.id,
    projectId: row.project_id,
    organizationId: row.organization_id,
    pullRequestNumber: row.pull_request_number,
    pullRequestTitle: row.pull_request_title,
    baseBranch: row.base_branch,
    headBranch: row.head_branch,
    baseCommitSha: row.base_commit_sha,
    headCommitSha: row.head_commit_sha,
    scanId: row.scan_id,
    scanStatus,
    checkStatus: row.check_status,
    verdictStatus: row.verdict_status ?? productionVerdict?.status ?? null,
    score: row.security_score_after ?? productionVerdict?.score ?? null,
    blockersCount: productionVerdict?.blockersCount ?? 0,
    topBlockers,
    productionVerdict,
    githubCheckRunId: row.github_check_run_id ?? null,
    source: "pr",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stale: false,
  };
}

export async function isPullRequestVerdictStale(
  admin: SupabaseClient,
  input: { projectId: string; pullRequestNumber: number; currentHeadSha: string }
): Promise<boolean> {
  const latest = await getLatestPullRequestScan(admin, {
    projectId: input.projectId,
    pullRequestNumber: input.pullRequestNumber,
  });
  if (!latest?.headCommitSha) return true;
  return latest.headCommitSha !== input.currentHeadSha;
}
