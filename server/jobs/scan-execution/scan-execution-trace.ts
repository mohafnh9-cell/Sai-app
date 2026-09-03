import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScanExecutorKind } from "@/lib/env/scan-scheduler-plan";
import { emitOperationalEvent } from "@/server/observability/operational-events";

export type ScanExecutionTraceStage =
  | "review_created"
  | "enqueue_attempt"
  | "enqueue_accepted"
  | "enqueue_failed"
  | "worker_started"
  | "scan_started"
  | "repository_fetched"
  | "scan_completed"
  | "scan_failed"
  | "verdict_persisted"
  | "user_cancelled";

export type ScanExecutionTrace = {
  stages: Array<{
    stage: ScanExecutionTraceStage;
    at: string;
    scheduler?: ScanExecutorKind | null;
    inngestEventId?: string | null;
    error?: string | null;
    metadata?: Record<string, unknown>;
  }>;
};

export function logScanExecutionTrace(
  event: string,
  fields: {
    reviewId?: string | null;
    scanJobId?: string | null;
    projectId?: string | null;
    organizationId?: string | null;
    commitSha?: string | null;
    scheduler?: ScanExecutorKind | string | null;
    inngestEventId?: string | null;
    status?: string | null;
    error?: string | null;
    stage?: ScanExecutionTraceStage;
  }
) {
  console.info({
    component: "scan-execution-trace",
    event,
    timestamp: new Date().toISOString(),
    reviewId: fields.reviewId ?? undefined,
    scanJobId: fields.scanJobId ?? undefined,
    projectId: fields.projectId ?? undefined,
    organizationId: fields.organizationId ?? undefined,
    commitSha: fields.commitSha ?? undefined,
    scheduler: fields.scheduler ?? undefined,
    inngestEventId: fields.inngestEventId ?? undefined,
    status: fields.status ?? undefined,
    error: fields.error ?? undefined,
    stage: fields.stage ?? undefined,
  });
}

export async function appendScanJobExecutionTrace(
  admin: SupabaseClient,
  scanJobId: string,
  entry: ScanExecutionTrace["stages"][number]
): Promise<void> {
  const { data: job } = await admin
    .from("scan_jobs")
    .select("metadata")
    .eq("id", scanJobId)
    .maybeSingle();
  const metadata = (job?.metadata as Record<string, unknown> | null) ?? {};
  const trace = (metadata.executionTrace as ScanExecutionTrace | undefined) ?? { stages: [] };
  trace.stages.push(entry);
  await admin
    .from("scan_jobs")
    .update({
      metadata: {
        ...metadata,
        executionTrace: trace,
        lastTraceStage: entry.stage,
        lastTraceAt: entry.at,
        ...(entry.inngestEventId ? { inngestEventId: entry.inngestEventId } : {}),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", scanJobId);
}

export async function emitScanTraceEvent(
  admin: SupabaseClient | null,
  input: {
    eventType: "job_failed" | "job_timed_out";
    organizationId?: string;
    projectId?: string;
    scanId?: string;
    scanJobId?: string;
    failureCode: string;
  }
) {
  await emitOperationalEvent(admin, {
    eventType: input.eventType,
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId: input.scanId,
    scanJobId: input.scanJobId,
    failureCode: input.failureCode,
  });
}
