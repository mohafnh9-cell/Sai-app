import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildMissionControlView } from "@/features/mission-control/lib/build-mission-control-view";
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
import { getCurrentProductionVerdict } from "@/server/production-verdict/service";

export async function getMissionControlView(
  supabase: SupabaseClient,
  projectId: string,
  organizationId: string
): Promise<{ view: MissionControlView; verdict: Awaited<ReturnType<typeof getCurrentProductionVerdict>> }> {
  const [
    { data: project },
    verdict,
    ,
    activeScanJob,
    completedJobsResult,
    latestScan,
    feedRows,
  ] = await Promise.all([
    supabase.from("projects").select("id, name").eq("id", projectId).single(),
    getCurrentProductionVerdict(supabase, projectId),
    Promise.resolve(null),
    supabase
      .from("scan_jobs")
      .select("id, status, metadata")
      .eq("project_id", projectId)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("scan_jobs")
      .select("id, status, metadata, completed_at")
      .eq("project_id", projectId)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(5),
    supabase
      .from("scans")
      .select("detected_stack")
      .eq("project_id", projectId)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("mission_control_feed_events")
      .select("id, message, occurred_at")
      .eq("project_id", projectId)
      .order("occurred_at", { ascending: false })
      .limit(20),
  ]);

  const scanInProgress = Boolean(activeScanJob.data);
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

  const view = buildMissionControlView({
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
  });

  return { view, verdict };
}

export async function appendMissionFeedEvent(
  supabase: SupabaseClient,
  input: { organizationId: string; projectId: string; message: string; sessionId?: string }
): Promise<void> {
  await supabase.from("mission_control_feed_events").insert({
    organization_id: input.organizationId,
    project_id: input.projectId,
    session_id: input.sessionId ?? null,
    message: input.message,
    kind: "info",
  });
}
