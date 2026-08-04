import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isAnalysisRunOwnedByProject } from "./get-analysis-run-snapshot";
import { resolveAnalysisRunForMissionControl } from "./resolve-analysis-run";
import type { AnalysisRunId } from "./types";

export function requestedAnalysisRunIdFromRequest(
  request: Request,
  bodyRunId?: string | null
): string | null {
  const url = new URL(request.url);
  return bodyRunId ?? url.searchParams.get("run");
}

/**
 * When isolation is enabled, always returns a run id for the project (resolved
 * when omitted). When disabled, returns the explicit query/body run id only.
 */
export async function resolveAnalysisRunIdForIsolation(
  admin: SupabaseClient,
  input: {
    projectId: string;
    organizationId: string;
    requestedRunId?: string | null;
    isolationEnabled: boolean;
  }
): Promise<{ runId: AnalysisRunId | null; invalidRequest: boolean }> {
  if (!input.isolationEnabled) {
    return { runId: input.requestedRunId ?? null, invalidRequest: false };
  }

  if (input.requestedRunId) {
    const owned = await isAnalysisRunOwnedByProject(admin, {
      projectId: input.projectId,
      organizationId: input.organizationId,
      runId: input.requestedRunId,
    });
    return owned
      ? { runId: input.requestedRunId, invalidRequest: false }
      : { runId: null, invalidRequest: true };
  }

  const resolved = await resolveAnalysisRunForMissionControl(admin, {
    projectId: input.projectId,
    organizationId: input.organizationId,
  });

  return { runId: resolved.runId, invalidRequest: false };
}
