import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EngineCapabilityId, EngineId } from "@/server/security-engines/types";
import { assertValidJobTransition } from "./state-machine";
import type { NetworkPolicy, SecurityJob, SecurityJobEventType, SecurityJobStatus } from "./types";

/**
 * Phase 35.5, section 29/54: billing and authorization live at THIS
 * boundary, not inside the worker. The worker only ever consumes rows this
 * function created -- it never accepts a client-supplied organizationId,
 * userId, or job payload directly. This is the ONLY place a SecurityJob
 * row is inserted.
 */
export type CreateSecurityJobInput = {
  organizationId: string;
  projectId: string;
  scanId: string;
  engine: EngineId;
  engineVersion: string;
  capabilities: EngineCapabilityId[];
  /** Audit trail only -- NOT a billing gate (see the function doc comment below). */
  requestedByUserId?: string | null;
  requestId?: string | null;
  priority?: number;
  timeoutMs?: number;
  networkPolicy?: NetworkPolicy;
};

const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_NETWORK_POLICY_BY_ENGINE: Record<EngineId, NetworkPolicy> = {
  native: "NONE",
  opengrep: "NONE",
  trivy: "REGISTRY_ONLY",
  crypto: "NONE",
  scorecard: "AUTHORIZED_EXTERNAL",
};

function mapRow(row: Record<string, unknown>): SecurityJob {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    projectId: row.project_id as string,
    scanId: row.scan_id as string,
    engine: row.engine as EngineId,
    engineVersion: row.engine_version as string,
    capabilities: (row.capabilities as EngineCapabilityId[] | null) ?? [],
    requestedBy: (row.requested_by as string | null) ?? null,
    requestId: (row.request_id as string | null) ?? null,
    status: row.status as SecurityJobStatus,
    cancelRequested: Boolean(row.cancel_requested),
    priority: (row.priority as number) ?? 0,
    attempt: (row.attempt as number) ?? 0,
    maxAttempts: (row.max_attempts as number) ?? 3,
    timeoutMs: (row.timeout_ms as number) ?? DEFAULT_TIMEOUT_MS,
    resourceLimits: (row.resource_limits as SecurityJob["resourceLimits"] | null) ?? { maxOutputBytes: 33_554_432 },
    networkPolicy: row.network_policy as NetworkPolicy,
    idempotencyKey: row.idempotency_key as string,
    claimedBy: (row.claimed_by as string | null) ?? null,
    claimedAt: (row.claimed_at as string | null) ?? null,
    error: (row.error as SecurityJob["error"]) ?? null,
    requestedAt: row.requested_at as string,
    startedAt: (row.started_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
  };
}

export class SecurityJobRejectedError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SecurityJobRejectedError";
  }
}

/**
 * Tenant-scoped, idempotent SecurityJob creation.
 *
 * Section 29: billing lives at the OPERATION boundary, not here, and is not
 * duplicated. A SecurityJob is a sub-execution of an already-created scan --
 * `scanId` is a foreign key to a `scans` row that could only exist if
 * assertOrganizationCanRunScan() already passed when that scan was created
 * (server/review-now/trigger-review.ts, server/full-product-audit/
 * run-security-tests.ts, etc.). Re-running that gate here would silently
 * double-bill a single scan (once for the scan itself, again per engine
 * job) -- a real bug caught while wiring this into
 * execute-unified-scan-pipeline.ts. Tenant scoping is still enforced: every
 * row is written with the caller-supplied organizationId/projectId/scanId,
 * and RLS scopes all reads to organization members.
 */
export async function createSecurityJob(admin: SupabaseClient, input: CreateSecurityJobInput): Promise<SecurityJob> {
  const idempotencyKey = createHash("sha256")
    .update(`${input.scanId}:${input.engine}`)
    .digest("hex")
    .slice(0, 32);

  const { data: existing } = await admin
    .from("security_jobs")
    .select("*")
    .eq("scan_id", input.scanId)
    .eq("engine", input.engine)
    .in("status", ["QUEUED", "RUNNING"])
    .maybeSingle();

  if (existing) {
    // Idempotent: a duplicate MCP/API retry for the same (scan, engine)
    // pair returns the existing in-flight job rather than creating a
    // second one (section 37).
    return mapRow(existing as Record<string, unknown>);
  }

  const { data, error } = await admin
    .from("security_jobs")
    .insert({
      organization_id: input.organizationId,
      project_id: input.projectId,
      scan_id: input.scanId,
      engine: input.engine,
      engine_version: input.engineVersion,
      capabilities: input.capabilities,
      requested_by: input.requestedByUserId,
      request_id: input.requestId ?? null,
      status: "QUEUED",
      cancel_requested: false,
      priority: input.priority ?? 0,
      timeout_ms: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      network_policy: input.networkPolicy ?? DEFAULT_NETWORK_POLICY_BY_ENGINE[input.engine],
      idempotency_key: idempotencyKey,
    })
    .select("*")
    .single();

  if (error) {
    // The unique partial index (one active job per scan+engine) is the
    // concurrency authority -- a race between two concurrent job-creation
    // calls resolves here, not earlier.
    if (error.code === "23505") {
      const { data: raced } = await admin
        .from("security_jobs")
        .select("*")
        .eq("scan_id", input.scanId)
        .eq("engine", input.engine)
        .in("status", ["QUEUED", "RUNNING"])
        .maybeSingle();
      if (raced) return mapRow(raced as Record<string, unknown>);
    }
    throw new SecurityJobRejectedError("job_creation_failed", `Could not create security job: ${error.message}`);
  }

  await recordJobEvent(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId: input.scanId,
    jobId: data.id as string,
    eventType: "JOB_QUEUED",
    detail: { engine: input.engine, engineVersion: input.engineVersion },
  });

  return mapRow(data as Record<string, unknown>);
}

/**
 * Atomic claim via the Postgres function (migration 063,
 * claim_next_security_job) -- FOR UPDATE SKIP LOCKED means two worker
 * processes polling concurrently can never both claim the same row
 * (section 5/37).
 */
export async function claimNextSecurityJob(admin: SupabaseClient, workerId: string): Promise<SecurityJob | null> {
  const { data, error } = await admin.rpc("claim_next_security_job", { p_worker_id: workerId });
  if (error) throw new Error(`Could not claim next security job: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return mapRow(row as Record<string, unknown>);
}

export async function recordJobEvent(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    scanId: string;
    jobId: string;
    eventType: SecurityJobEventType;
    detail?: Record<string, unknown>;
  }
): Promise<void> {
  await admin.from("security_job_events").insert({
    organization_id: input.organizationId,
    project_id: input.projectId,
    scan_id: input.scanId,
    job_id: input.jobId,
    event_type: input.eventType,
    detail: input.detail ?? {},
  });
}

/**
 * Cancellation: sets a flag the worker polls for (see worker/run-job.ts) --
 * this function does not itself claim to have stopped execution. The
 * worker is the only writer of the terminal CANCELLED status, once it has
 * actually terminated the subprocess (section 14: never confuse "cancel
 * requested" with "execution actually stopped").
 */
export async function requestSecurityJobCancellation(
  admin: SupabaseClient,
  input: { organizationId: string; jobId: string }
): Promise<void> {
  await admin
    .from("security_jobs")
    .update({ cancel_requested: true })
    .eq("id", input.jobId)
    .eq("organization_id", input.organizationId)
    .in("status", ["QUEUED", "RUNNING"]);
}

/**
 * Transition helper the worker uses -- validates against the state machine
 * before writing, so an invalid transition throws instead of silently
 * corrupting job state.
 */
export async function transitionSecurityJob(
  admin: SupabaseClient,
  input: {
    jobId: string;
    from: SecurityJobStatus;
    to: SecurityJobStatus;
    error?: { code: string; message: string } | null;
  }
): Promise<void> {
  assertValidJobTransition(input.from, input.to);

  const isTerminal = ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT", "REJECTED"].includes(input.to);
  const { error: updateError } = await admin
    .from("security_jobs")
    .update({
      status: input.to,
      error: input.error ?? null,
      completed_at: isTerminal ? new Date().toISOString() : null,
    })
    .eq("id", input.jobId)
    .eq("status", input.from); // optimistic concurrency: only apply if still in the expected state

  if (updateError) {
    throw new Error(`Could not transition security job ${input.jobId}: ${updateError.message}`);
  }

  // An engine reaching a terminal state is the event that can complete a
  // scan's evidence. If it is the last one, this generates the verdict (see
  // production-verdict/evidence-finalization.ts). Dynamic import: the verdict
  // pipeline depends on this module's data, not the other way around.
  if (isTerminal) {
    const { finalizeVerdictForTerminalSecurityJob } = await import(
      "@/server/production-verdict/evidence-finalization"
    );
    await finalizeVerdictForTerminalSecurityJob(admin, input.jobId);
  }
}
