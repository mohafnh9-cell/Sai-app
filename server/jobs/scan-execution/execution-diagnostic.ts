import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveScanSchedulerPlan } from "@/lib/env/scan-scheduler-plan";
import type { ScanExecutionTrace } from "./scan-execution-trace";

export type ReviewExecutionDiagnostic = {
  reviewId: string;
  reviewStatus: string | null;
  commitSha: string | null;
  queuedAt: string | null;
  processingStartedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  errorCode: string | null;
  scheduler: {
    configuredMode: string | null;
    plannedExecutor: string | null;
    allowlistApplied: boolean;
    orgFallbackUsed: boolean;
    planError: string | null;
  };
  scanJob: {
    id: string | null;
    status: string | null;
    enqueueStatus: string | null;
    inngestEventId: string | null;
    workerStarted: boolean;
    lastHeartbeat: string | null;
    failureReason: string | null;
    executionTrace: ScanExecutionTrace["stages"];
  };
};

export async function buildReviewExecutionDiagnostic(
  admin: SupabaseClient,
  reviewId: string
): Promise<ReviewExecutionDiagnostic | null> {
  const { data: scan } = await admin
    .from("scans")
    .select(
      "id, status, commit_sha, organization_id, queued_at, processing_started_at, completed_at, failed_at, error_code, created_at"
    )
    .eq("id", reviewId)
    .maybeSingle();

  if (!scan) return null;

  const organizationId = scan.organization_id as string;
  const plan = resolveScanSchedulerPlan(organizationId);

  const { data: jobs } = await admin
    .from("scan_jobs")
    .select("id, status, metadata, heartbeat_at, failure_code, failure_message, started_at")
    .eq("scan_id", reviewId)
    .order("created_at", { ascending: false })
    .limit(1);

  const job = jobs?.[0] ?? null;
  const metadata = (job?.metadata as Record<string, unknown> | null) ?? {};
  const trace = (metadata.executionTrace as ScanExecutionTrace | undefined)?.stages ?? [];
  const enqueueAccepted = trace.some((s) => s.stage === "enqueue_accepted");
  const workerStarted = trace.some((s) => s.stage === "worker_started") || Boolean(job?.started_at);

  return {
    reviewId,
    reviewStatus: (scan.status as string) ?? null,
    commitSha: (scan.commit_sha as string | null) ?? null,
    queuedAt: (scan.queued_at as string | null) ?? (scan.created_at as string | null) ?? null,
    processingStartedAt: (scan.processing_started_at as string | null) ?? null,
    completedAt: (scan.completed_at as string | null) ?? null,
    failedAt: (scan.failed_at as string | null) ?? null,
    errorCode: (scan.error_code as string | null) ?? null,
    scheduler: {
      configuredMode: plan.ok ? plan.configuredMode : plan.configuredMode,
      plannedExecutor: plan.ok ? plan.executor : null,
      allowlistApplied: plan.ok ? plan.allowlistApplied : false,
      orgFallbackUsed: plan.ok ? plan.orgFallbackUsed : false,
      planError: plan.ok ? null : plan.message,
    },
    scanJob: {
      id: (job?.id as string | null) ?? null,
      status: (job?.status as string | null) ?? null,
      enqueueStatus: enqueueAccepted ? "accepted" : job ? "pending_or_failed" : "no_job",
      inngestEventId: (metadata.inngestEventId as string | null) ?? null,
      workerStarted,
      lastHeartbeat: (job?.heartbeat_at as string | null) ?? null,
      failureReason:
        (job?.failure_message as string | null) ??
        (plan.ok ? null : plan.message),
      executionTrace: trace,
    },
  };
}
