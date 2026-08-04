import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isAnalysisRunImmutable } from "./is-analysis-run-immutable";
import type { AnalysisRunId } from "./types";

export class AnalysisRunImmutableError extends Error {
  readonly code = "analysis_run_immutable" as const;
  readonly runId: AnalysisRunId;

  constructor(runId: AnalysisRunId) {
    super(`Analysis run ${runId} is immutable`);
    this.name = "AnalysisRunImmutableError";
    this.runId = runId;
  }
}

export async function assertAnalysisRunMutable(
  admin: SupabaseClient,
  input: { runId: AnalysisRunId; projectId: string; organizationId: string }
): Promise<void> {
  const { data, error } = await admin
    .from("scans")
    .select("id, status, immutability_locked_at")
    .eq("id", input.runId)
    .eq("project_id", input.projectId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load analysis run: ${error.message}`);
  }
  if (!data) {
    throw new Error(`Analysis run not found: ${input.runId}`);
  }

  if (
    isAnalysisRunImmutable({
      status: String(data.status),
      immutabilityLockedAt: data.immutability_locked_at as string | null,
    })
  ) {
    throw new AnalysisRunImmutableError(input.runId);
  }
}
