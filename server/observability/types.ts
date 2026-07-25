export type OperationalEventType =
  | "job_created"
  | "job_queued"
  | "job_started"
  | "job_completed"
  | "job_failed"
  | "job_retried"
  | "job_cancelled"
  | "job_timed_out"
  | "job_recovered"
  | "duplicate_webhook_detected"
  | "duplicate_scan_prevented"
  | "verdict_created"
  | "verdict_failed"
  | "notification_sent"
  | "notification_failed"
  | "invalid_transition"
  | "recovery_exhausted";

export type OperationalEventInput = {
  eventType: OperationalEventType;
  scanJobId?: string | null;
  scanId?: string | null;
  projectId?: string | null;
  organizationId?: string | null;
  jobType?: string | null;
  attempt?: number | null;
  durationMs?: number | null;
  queueWaitMs?: number | null;
  failureCode?: string | null;
  provider?: string | null;
  metadata?: Record<string, unknown>;
};

export const FORBIDDEN_LOG_KEYS = [
  "token",
  "providerToken",
  "secret",
  "password",
  "authorization",
  "rawBody",
  "webhookPayload",
  "payload",
  "sourceCode",
  "repositoryContents",
  "apiKey",
  "GITHUB_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export const METRIC_COUNTERS = [
  "jobs_created_total",
  "jobs_completed_total",
  "jobs_failed_total",
  "jobs_retried_total",
  "jobs_timed_out_total",
  "jobs_recovered_total",
  "duplicate_webhooks_total",
  "duplicate_scans_prevented_total",
  "notification_failures_total",
  "stuck_jobs_total",
] as const;

export type MetricCounterName = (typeof METRIC_COUNTERS)[number];

export const DEFAULT_QUEUE_STALE_MINUTES = 10;
export const DEFAULT_RECOVERY_MAX_ATTEMPTS = 3;
export const DEFAULT_JOB_TIMEOUT_MS = 15 * 60 * 1000;

export function getQueueStaleMinutes(): number {
  const raw = Number(process.env.SCAN_JOB_QUEUE_STALE_MINUTES ?? DEFAULT_QUEUE_STALE_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_QUEUE_STALE_MINUTES;
}

export function getRecoveryMaxAttempts(): number {
  const raw = Number(process.env.SCAN_JOB_RECOVERY_MAX_ATTEMPTS ?? DEFAULT_RECOVERY_MAX_ATTEMPTS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RECOVERY_MAX_ATTEMPTS;
}
