import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getProductionReviewState } from "@/server/review-cancel/get-production-review-state";
import { isAnalysisRunOwnedByProject } from "./get-analysis-run-snapshot";
import type { AnalysisRunId, AnalysisRunResolveResult } from "./types";

const ACTIVE_SCAN_STATUSES = [
  "queued",
  "fetching_repository",
  "indexing",
  "scanning",
  "calculating_score",
  "cancelling",
] as const;

export async function resolveAnalysisRunForMissionControl(
  admin: SupabaseClient,
  input: {
    projectId: string;
    organizationId: string;
    requestedRunId?: string | null;
  }
): Promise<AnalysisRunResolveResult> {
  if (input.requestedRunId) {
    const owned = await isAnalysisRunOwnedByProject(admin, {
      projectId: input.projectId,
      organizationId: input.organizationId,
      runId: input.requestedRunId,
    });

    if (owned) {
      console.info({
        component: "analysis-run-resolver",
        event: "analysis_run_resolved",
        projectId: input.projectId,
        runId: input.requestedRunId,
        source: "query",
      });
      return { runId: input.requestedRunId, source: "query", valid: true };
    }

    console.warn({
      component: "analysis-run-resolver",
      event: "analysis_run_invalid",
      projectId: input.projectId,
      runId: input.requestedRunId,
    });
    return { runId: null, source: "none", valid: false };
  }

  const reviewState = await getProductionReviewState(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
  });

  if (reviewState.scanId && reviewState.hasActiveReview) {
    console.info({
      component: "analysis-run-resolver",
      event: "analysis_run_resolved",
      projectId: input.projectId,
      runId: reviewState.scanId,
      source: "active",
    });
    return { runId: reviewState.scanId, source: "active", valid: true };
  }

  const { data: latestCompleted } = await admin
    .from("scans")
    .select("id")
    .eq("project_id", input.projectId)
    .eq("organization_id", input.organizationId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestCompleted?.id) {
    console.info({
      component: "analysis-run-resolver",
      event: "analysis_run_resolved",
      projectId: input.projectId,
      runId: latestCompleted.id,
      source: "latest_completed",
    });
    return {
      runId: latestCompleted.id as AnalysisRunId,
      source: "latest_completed",
      valid: true,
    };
  }

  const { data: latestActive } = await admin
    .from("scans")
    .select("id")
    .eq("project_id", input.projectId)
    .eq("organization_id", input.organizationId)
    .in("status", [...ACTIVE_SCAN_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestActive?.id) {
    console.info({
      component: "analysis-run-resolver",
      event: "analysis_run_resolved",
      projectId: input.projectId,
      runId: latestActive.id,
      source: "active",
    });
    return { runId: latestActive.id as AnalysisRunId, source: "active", valid: true };
  }

  return { runId: null, source: "none", valid: true };
}

/** Project-wide alias — same resolution order as Mission Control. */
export const resolveAnalysisRunForProject = resolveAnalysisRunForMissionControl;
