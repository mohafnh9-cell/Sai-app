import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { deploymentPostureOf, type DeploymentPosture } from "@/brain/production-verdict/deployment-posture";
import { safeParseProductionVerdict } from "@/brain/production-verdict/schema";
import type { AnalysisRunId } from "./types";

export type AnalysisRunListItem = {
  runId: AnalysisRunId;
  status: string;
  commitSha: string | null;
  branch: string | null;
  createdAt: string;
  completedAt: string | null;
  securityScore: number | null;
  verdictStatus: string | null;
  /** Canonical deployment posture of this run's persisted verdict; null when there is no readable verdict. */
  deploymentPosture: DeploymentPosture | null;
};

export async function listAnalysisRunsForProject(
  admin: SupabaseClient,
  input: { projectId: string; organizationId: string; limit?: number }
): Promise<AnalysisRunListItem[]> {
  const limit = input.limit ?? 12;

  const { data: scans, error } = await admin
    .from("scans")
    .select("id, status, commit_sha, branch, created_at, completed_at, security_score")
    .eq("project_id", input.projectId)
    .eq("organization_id", input.organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list analysis runs: ${error.message}`);
  }

  const runIds = (scans ?? []).map((row) => row.id as string);
  if (runIds.length === 0) return [];

  const { data: verdicts } = await admin
    .from("production_verdicts")
    .select("scan_id, status, verdict")
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .in("scan_id", runIds);

  const verdictByScan = new Map(
    (verdicts ?? []).map((row) => {
      // The deployment posture is derived from the full verdict through the canonical gate, never from status alone.
      const parsed = safeParseProductionVerdict(row.verdict);
      return [
        row.scan_id as string,
        {
          status: row.status as string,
          posture: parsed ? deploymentPostureOf(parsed) : null,
        },
      ] as const;
    })
  );

  return (scans ?? []).map((row) => ({
    runId: row.id as string,
    status: String(row.status ?? "unknown"),
    commitSha: (row.commit_sha as string | null) ?? null,
    branch: (row.branch as string | null) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at as string).toISOString() : null,
    securityScore: (row.security_score as number | null) ?? null,
    verdictStatus: verdictByScan.get(row.id as string)?.status ?? null,
    deploymentPosture: verdictByScan.get(row.id as string)?.posture ?? null,
  }));
}
