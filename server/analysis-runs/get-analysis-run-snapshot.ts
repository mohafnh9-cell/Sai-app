import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getProductionVerdictByScan } from "@/server/production-verdict/core";
import type { AnalysisRunId, AnalysisRunSnapshot } from "./types";

export class AnalysisRunNotFoundError extends Error {
  constructor(message = "Analysis run not found") {
    super(message);
    this.name = "AnalysisRunNotFoundError";
  }
}

export async function getAnalysisRunSnapshot(
  admin: SupabaseClient,
  input: { organizationId: string; projectId: string; runId: AnalysisRunId }
): Promise<AnalysisRunSnapshot> {
  const { data: scan, error } = await admin
    .from("scans")
    .select(
      "id, project_id, organization_id, status, commit_sha, branch, started_at, completed_at"
    )
    .eq("id", input.runId)
    .eq("project_id", input.projectId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load analysis run: ${error.message}`);
  }

  if (!scan) {
    throw new AnalysisRunNotFoundError();
  }

  const verdict = await getProductionVerdictByScan(admin, input.runId);

  return {
    runId: scan.id as string,
    projectId: scan.project_id as string,
    organizationId: scan.organization_id as string,
    status: String(scan.status ?? "unknown"),
    commitSha: (scan.commit_sha as string | null) ?? null,
    branch: (scan.branch as string | null) ?? null,
    startedAt: (scan.started_at as string | null) ?? null,
    completedAt: (scan.completed_at as string | null) ?? null,
    verdict,
  };
}

export async function isAnalysisRunOwnedByProject(
  admin: SupabaseClient,
  input: { projectId: string; organizationId: string; runId: AnalysisRunId }
): Promise<boolean> {
  const { data } = await admin
    .from("scans")
    .select("id")
    .eq("id", input.runId)
    .eq("project_id", input.projectId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  return Boolean(data?.id);
}
