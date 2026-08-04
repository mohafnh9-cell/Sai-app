import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildMissionControlView } from "@/features/mission-control/lib/build-mission-control-view";
import { getTranslator } from "@/lib/i18n/server";
import { parseMissionTeamExecutionFromMetadata } from "@/features/mission-control/lib/parse-team-execution";
import {
  mergeTeamExecutionFromMetadata,
  parseBusinessLogicMetricsFromMetadata,
} from "@/features/mission-control/lib/parse-business-logic-metrics";
import {
  mergeLlmTeamExecutionFromMetadata,
  parseLlmMetricsFromMetadata,
} from "@/features/mission-control/lib/parse-llm-metrics";
import type { MissionControlView, MissionFeedItem } from "@/features/mission-control/types";
import { getCurrentProductionVerdict, getProductionVerdictByScan } from "@/server/production-verdict/service";
import { getProductionReviewState } from "@/server/review-cancel/get-production-review-state";

export type MissionControlViewOptions = {
  analysisRunId?: string | null;
};

export async function getMissionControlView(
  supabase: SupabaseClient,
  projectId: string,
  organizationId: string,
  options?: MissionControlViewOptions
): Promise<{ view: MissionControlView; verdict: Awaited<ReturnType<typeof getCurrentProductionVerdict>> }> {
  const analysisRunId = options?.analysisRunId ?? null;

  const feedBase = supabase
    .from("mission_control_feed_events")
    .select("id, message, occurred_at")
    .eq("project_id", projectId)
    .order("occurred_at", { ascending: false })
    .limit(20);

  const activeJobBase = supabase
    .from("scan_jobs")
    .select("id, status, metadata")
    .eq("project_id", projectId)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1);

  const completedJobsBase = supabase
    .from("scan_jobs")
    .select("id, status, metadata, completed_at")
    .eq("project_id", projectId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(5);

  const feedQuery = analysisRunId ? feedBase.eq("scan_id", analysisRunId) : feedBase;
  const activeJobQuery = analysisRunId ? activeJobBase.eq("scan_id", analysisRunId) : activeJobBase;
  const completedJobsQuery = analysisRunId
    ? completedJobsBase.eq("scan_id", analysisRunId)
    : completedJobsBase;

  const latestScanQuery = analysisRunId
    ? supabase
        .from("scans")
        .select("detected_stack, status")
        .eq("id", analysisRunId)
        .eq("project_id", projectId)
        .maybeSingle()
    : supabase
        .from("scans")
        .select("detected_stack")
        .eq("project_id", projectId)
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

  const latestReviewScanQuery = analysisRunId
    ? supabase
        .from("scans")
        .select(
          "status, cancelled_at, cancelled_by, last_completed_phase, progress_at_cancellation, created_at"
        )
        .eq("id", analysisRunId)
        .eq("project_id", projectId)
        .maybeSingle()
    : supabase
        .from("scans")
        .select(
          "status, cancelled_at, cancelled_by, last_completed_phase, progress_at_cancellation, created_at"
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

  const [
    { data: project },
    reviewState,
    activeScanJob,
    completedJobsResult,
    latestScan,
    feedRows,
    latestReviewScan,
  ] = await Promise.all([
    supabase.from("projects").select("id, name").eq("id", projectId).maybeSingle(),
    getProductionReviewState(supabase, { organizationId, projectId }),
    activeJobQuery.maybeSingle(),
    completedJobsQuery,
    latestScanQuery,
    feedQuery,
    latestReviewScanQuery,
  ]);

  const verdict = analysisRunId
    ? await getProductionVerdictByScan(supabase, analysisRunId)
    : await getCurrentProductionVerdict(supabase, projectId);

  const scanInProgress = analysisRunId
    ? reviewState.hasActiveReview && reviewState.scanId === analysisRunId
    : reviewState.hasActiveReview;
  const cancelledReview =
    latestReviewScan.data?.status === "cancelled" &&
    latestReviewScan.data.cancelled_at &&
    !scanInProgress
      ? {
          cancelledAt: latestReviewScan.data.cancelled_at as string,
          cancelledByUserId: (latestReviewScan.data.cancelled_by as string | null) ?? null,
          lastCompletedPhase: (latestReviewScan.data.last_completed_phase as string | null) ?? null,
          progressAtCancellation:
            (latestReviewScan.data.progress_at_cancellation as number | null) ?? 0,
        }
      : null;
  const feedFromDb: MissionFeedItem[] = (feedRows.data ?? []).map((row) => ({
    id: row.id,
    message: row.message,
    occurredAt: row.occurred_at,
  }));

  const completedJobs = completedJobsResult.data ?? [];
  const latestWithPlatform = completedJobs.find(
    (j) => j.metadata && ((j.metadata as Record<string, unknown>).platform ?? (j.metadata as Record<string, unknown>).platformConvergence)
  );
  const metaSource = latestWithPlatform?.metadata ?? activeScanJob.data?.metadata;
  const meta = (metaSource ?? {}) as Record<string, unknown>;
  const teamExecution = {
    ...parseMissionTeamExecutionFromMetadata(meta),
    ...mergeTeamExecutionFromMetadata(meta),
    ...mergeLlmTeamExecutionFromMetadata(meta),
  };
  const businessLogicMetrics = parseBusinessLogicMetricsFromMetadata(meta);
  const llmMetrics = parseLlmMetricsFromMetadata(meta);

  const { locale, t } = await getTranslator("missionControl");

  const view = buildMissionControlView(
    {
      projectId,
      projectName: project?.name ?? "Project",
      verdict,
      scanInProgress,
      detectedStack: (latestScan.data?.detected_stack as Record<string, unknown>) ?? null,
      feedFromDb,
      sessionProgress: typeof meta.progress === "number" ? meta.progress : null,
      sessionPhase: typeof meta.phase === "string" ? meta.phase : null,
      sessionEtaSeconds: typeof meta.etaSeconds === "number" ? meta.etaSeconds : null,
      teamExecution: Object.keys(teamExecution).length > 0 ? teamExecution : undefined,
      businessLogicMetrics,
      llmMetrics,
      cancelledReview,
      t,
    },
    locale
  );

  return { view, verdict };
}

export async function appendMissionFeedEvent(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    message: string;
    sessionId?: string;
    scanId?: string;
  }
): Promise<void> {
  await supabase.from("mission_control_feed_events").insert({
    organization_id: input.organizationId,
    project_id: input.projectId,
    session_id: input.sessionId ?? null,
    scan_id: input.scanId ?? null,
    message: input.message,
    kind: "info",
  });
}
