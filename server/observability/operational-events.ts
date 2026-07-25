import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeOperationalFields } from "./sanitize";
import type { MetricCounterName, OperationalEventInput, OperationalEventType } from "./types";
import { incrementMetricCounter } from "./metrics";

const EVENT_TO_METRIC: Partial<Record<OperationalEventType, MetricCounterName>> = {
  job_created: "jobs_created_total",
  job_completed: "jobs_completed_total",
  job_failed: "jobs_failed_total",
  job_retried: "jobs_retried_total",
  job_timed_out: "jobs_timed_out_total",
  job_recovered: "jobs_recovered_total",
  duplicate_webhook_detected: "duplicate_webhooks_total",
  duplicate_scan_prevented: "duplicate_scans_prevented_total",
  notification_failed: "notification_failures_total",
};

function mapEventToMetric(eventType: OperationalEventType): MetricCounterName | null {
  return EVENT_TO_METRIC[eventType] ?? null;
}

export function buildOperationalLogPayload(input: OperationalEventInput): Record<string, unknown> {
  return sanitizeOperationalFields({
    component: "operational-events",
    eventType: input.eventType,
    timestamp: new Date().toISOString(),
    scanJobId: input.scanJobId ?? undefined,
    scanId: input.scanId ?? undefined,
    projectId: input.projectId ?? undefined,
    organizationId: input.organizationId ?? undefined,
    jobType: input.jobType ?? undefined,
    attempt: input.attempt ?? undefined,
    durationMs: input.durationMs ?? undefined,
    queueWaitMs: input.queueWaitMs ?? undefined,
    failureCode: input.failureCode ?? undefined,
    provider: input.provider ?? undefined,
    metadata: input.metadata ?? undefined,
  });
}

export async function emitOperationalEvent(
  admin: SupabaseClient | null,
  input: OperationalEventInput
): Promise<void> {
  const payload = buildOperationalLogPayload(input);
  console.info(payload);

  const metric = mapEventToMetric(input.eventType);
  if (metric) incrementMetricCounter(metric);

  if (!admin) return;

  try {
    const { error } = await admin.from("scan_job_events").insert({
      event_type: input.eventType,
      scan_job_id: input.scanJobId ?? null,
      scan_id: input.scanId ?? null,
      organization_id: input.organizationId ?? null,
      project_id: input.projectId ?? null,
      job_type: input.jobType ?? null,
      attempt: input.attempt ?? null,
      duration_ms: input.durationMs ?? null,
      queue_wait_ms: input.queueWaitMs ?? null,
      failure_code: input.failureCode ?? null,
      provider: input.provider ?? null,
      metadata: sanitizeOperationalFields(input.metadata ?? {}),
    });

    if (error) {
      console.error({
        component: "operational-events",
        eventType: "event_persist_failed",
        message: error.message,
      });
    }
  } catch (persistError) {
    console.error({
      component: "operational-events",
      eventType: "event_persist_failed",
      message: persistError instanceof Error ? persistError.message : "unknown",
    });
  }
}
