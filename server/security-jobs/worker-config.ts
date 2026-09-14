import "server-only";

/**
 * Phase 35.5, section 50: centralized worker configuration -- never
 * scattered across files.
 */

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function isSecurityWorkerEnabled(): boolean {
  return process.env.SECURITY_WORKER_ENABLED?.trim() === "true";
}

export const WORKER_CONFIG = {
  pollIntervalMs: intFromEnv("SECURITY_WORKER_POLL_INTERVAL_MS", 2_000),
  maxConcurrentJobs: intFromEnv("SECURITY_WORKER_MAX_CONCURRENT_JOBS", 3),
  healthPort: intFromEnv("SECURITY_WORKER_HEALTH_PORT", 8080),
  /** Distinct id per worker PROCESS (not per job) -- used for claim fencing. */
  workerId: process.env.SECURITY_WORKER_ID?.trim() || `worker-${process.pid}-${Date.now()}`,
  defaultOutputLimitBytes: intFromEnv("SECURITY_WORKER_MAX_OUTPUT_BYTES", 32 * 1024 * 1024),
};
