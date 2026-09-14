import "server-only";

import type { EngineCapabilityId, EngineId } from "@/server/security-engines/types";

/**
 * Phase 35.5: the canonical SecurityJob domain -- the queue between
 * Vercel/MCP (job creation, billing-gated, tenant-scoped) and the
 * standalone Security Execution Worker (job execution, outside Vercel).
 * Matches database/migrations/063_security_jobs.sql exactly.
 */

export type SecurityJobStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT"
  | "REJECTED";

export type NetworkPolicy = "NONE" | "REGISTRY_ONLY" | "TARGET_ONLY" | "CONTROL_PLANE_ONLY" | "AUTHORIZED_EXTERNAL";

export type SecurityJobResourceLimits = {
  maxOutputBytes: number;
  maxMemoryMb?: number;
};

export type SecurityJob = {
  id: string;
  organizationId: string;
  projectId: string;
  scanId: string;

  engine: EngineId;
  engineVersion: string;
  capabilities: EngineCapabilityId[];

  requestedBy: string | null;
  requestId: string | null;

  status: SecurityJobStatus;
  cancelRequested: boolean;

  priority: number;
  attempt: number;
  maxAttempts: number;

  timeoutMs: number;
  resourceLimits: SecurityJobResourceLimits;
  networkPolicy: NetworkPolicy;

  idempotencyKey: string;
  claimedBy: string | null;
  claimedAt: string | null;

  error: { code: string; message: string } | null;

  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type SecurityJobEventType =
  | "JOB_QUEUED"
  | "JOB_CLAIMED"
  | "ENGINE_STARTED"
  | "ENGINE_COMPLETED"
  | "ENGINE_FAILED"
  | "ENGINE_TIMED_OUT"
  | "ENGINE_CANCELLED"
  | "FINDINGS_NORMALIZED"
  | "EVIDENCE_PERSISTED"
  | "CORRELATION_COMPLETED"
  | "JOB_REJECTED"
  | "JOB_RETRY_SCHEDULED";

/**
 * Section 60: result semantics a caller (MCP, Production Verdict) must be
 * able to distinguish. "Engine unavailable" is never "secure."
 */
export type SecurityJobResultSemantics =
  | "COMPLETED_WITH_FINDINGS"
  | "COMPLETED_CLEAN"
  | "COMPLETED_WITH_WARNINGS"
  | "FAILED"
  | "TIMED_OUT"
  | "CANCELLED"
  | "SKIPPED"
  | "UNAVAILABLE";

export function classifyJobResultSemantics(input: {
  status: SecurityJobStatus;
  findingsCount: number;
  errorsCount: number;
}): SecurityJobResultSemantics {
  if (input.status === "TIMED_OUT") return "TIMED_OUT";
  if (input.status === "CANCELLED") return "CANCELLED";
  if (input.status === "REJECTED") return "UNAVAILABLE";
  if (input.status === "FAILED") return "FAILED";
  if (input.status === "QUEUED" || input.status === "RUNNING") return "UNAVAILABLE";
  // COMPLETED:
  if (input.findingsCount > 0) return "COMPLETED_WITH_FINDINGS";
  if (input.errorsCount > 0) return "COMPLETED_WITH_WARNINGS";
  return "COMPLETED_CLEAN";
}
