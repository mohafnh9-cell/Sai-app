import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import type { SecurityDecisionFinalizeInput } from "@/brain/production-verdict/finalize-verdict";
import { assessEvidenceReadiness, PENDING_ENGINE_STATUSES } from "./evidence-readiness";
import { mergeScanMetrics } from "./scan-metrics";

/**
 * Verdict finalization: the Production Verdict for a scan is generated once,
 * and only after the evidence it is computed from is final.
 *
 * Previously the scan runner generated the verdict as soon as its own pipeline
 * stage finished. External engine jobs (opengrep/trivy/crypto) run
 * asynchronously on the security worker, so the verdict was routinely written
 * while engines were still running. The engine-coverage check then reported
 * them as incomplete, produced `insufficient_data`, and -- because a completed
 * scan's verdict is immutable -- that answer was frozen even though every
 * engine finished successfully moments later.
 *
 * Lifecycle now (driven by real job state, never by delays):
 *
 *   native scan -> convergence stage -> markVerdictEvidenceReady()
 *                                           |
 *   every engine job reaches a terminal state (COMPLETED / FAILED /
 *   TIMED_OUT / CANCELLED / REJECTED), in either order relative to the marker
 *                                           v
 *                            finalizeVerdictWhenEvidenceComplete()
 *                                           v
 *                       verdict generated (idempotent) -> pointer updated
 *
 * Both the runner and every job's terminal transition call finalize. Whichever
 * observes "marker set AND no job pending" last generates the verdict; the
 * other observes an incomplete state and defers. A failed or timed-out engine
 * is terminal, so it does not block finalization: the verdict is generated
 * and the failure is what makes it insufficient_data (honestly), instead of
 * an in-flight engine being mistaken for a failed one.
 */

export const EVIDENCE_READY_KEY = "verdictEvidenceReadyAt";
const STORED_DECISION_KEY = "verdictSecurityDecision";
export const VERDICT_EVIDENCE_STORED_DECISION_KEY = STORED_DECISION_KEY;
export const VERDICT_EVIDENCE_KEY = "verdictEvidence";
/** A verdict younger than this and without its evidence record gets it completed; older verdicts are never touched. */
export const VERDICT_EVIDENCE_BACKFILL_WINDOW_MS = 10 * 60_000;

const PENDING_JOB_STATUSES = PENDING_ENGINE_STATUSES;

/** Engine jobs have their own timeout; one that outlived it (plus this grace) is abandoned, not slow. */
const DEFAULT_ENGINE_TIMEOUT_MS = 10 * 60_000;
const ENGINE_ABANDON_GRACE_MS = 60_000;
/** Deferred verdicts are only recovered for scans that finished at least this long ago (the runner's own tail is long over). */
export const DEFERRED_VERDICT_MIN_AGE_MS = 5 * 60_000;

export type FinalizeMode =
  /** Normal pipeline: wait for the evidence marker (when engine jobs exist) and for every engine job to be terminal. */
  | "pipeline"
  /** Crash recovery for an orphaned scan job: generate from whatever evidence exists. */
  | "recovery";

export type FinalizeOutcome =
  | { status: "generated"; verdict: ProductionVerdictV1 }
  | { status: "already_exists" }
  | { status: "deferred"; reason: "engines_pending" | "evidence_not_ready"; pendingEngines: string[] }
  | { status: "skipped"; reason: "scan_not_found" | "scan_not_completed" | "verdict_not_generated" };

type Row = Record<string, unknown>;

function metricsOf(row: Row | null | undefined): Record<string, unknown> {
  const metrics = row?.metrics;
  return metrics && typeof metrics === "object" && !Array.isArray(metrics)
    ? (metrics as Record<string, unknown>)
    : {};
}

function isStoredDecision(value: unknown): value is SecurityDecisionFinalizeInput {
  const decision = value as SecurityDecisionFinalizeInput | null;
  return (
    !!decision &&
    typeof decision === "object" &&
    typeof decision.decision?.deploymentVerdict === "string" &&
    typeof decision.decision?.primaryRecommendation === "string" &&
    typeof decision.decision?.decisionId === "string" &&
    typeof decision.explanation?.founder?.headline === "string"
  );
}

/**
 * Records that this scan's own pipeline (native scan, red-team, orchestration,
 * attack simulation) is finished, and preserves the minimal security decision
 * the verdict needs, so a verdict generated later -- by the worker, when the
 * last engine finishes -- has exactly the evidence an inline generation would.
 */
export async function markVerdictEvidenceReady(
  admin: SupabaseClient,
  input: {
    scanId: string;
    organizationId: string;
    securityDecision?: SecurityDecisionFinalizeInput | null;
  }
): Promise<void> {
  const decision = input.securityDecision;
  const stored = decision
    ? {
        decision: {
          deploymentVerdict: decision.decision.deploymentVerdict,
          primaryRecommendation: decision.decision.primaryRecommendation,
          confidence: decision.decision.confidence,
          decisionId: decision.decision.decisionId,
        },
        explanation: { founder: { headline: decision.explanation.founder.headline } },
      }
    : null;

  const result = await mergeScanMetrics(admin, {
    scanId: input.scanId,
    organizationId: input.organizationId,
    patch: { [EVIDENCE_READY_KEY]: new Date().toISOString(), [STORED_DECISION_KEY]: stored },
    requireStatus: ["completed"],
  });
  if (!result.ok) {
    if (result.reason === "scan_not_found") throw new Error(`Cannot mark evidence ready: scan ${input.scanId} not found`);
    throw new Error(`Could not mark verdict evidence ready: ${result.reason}${result.message ? ` (${result.message})` : ""}`);
  }
}

export async function finalizeVerdictWhenEvidenceComplete(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    scanId: string;
    scanJobId?: string | null;
    securityDecisionReport?: SecurityDecisionFinalizeInput | null;
    mode?: FinalizeMode;
    /**
     * Complete the evidence record of a verdict created in the last 10 minutes that lacks it (its creator was cut short). OFF by default:
     * only the normal finalization callers (runner wait, engine-terminal hook) and the explicit recovery job turn it on. Never a read
     * path (HTTP GET, MCP read tools, the review-state read).
     */
    backfillEvidence?: boolean;
    /** Injectable for tests; defaults to the canonical generator. */
    generate?: (
      admin: SupabaseClient,
      input: {
        organizationId: string;
        projectId: string;
        scanId: string;
        scanJobId?: string | null;
        securityDecisionReport?: SecurityDecisionFinalizeInput | null;
        finalizedBy?: FinalizeMode;
      }
    ) => Promise<ProductionVerdictV1 | null>;
  }
): Promise<FinalizeOutcome> {
  const mode = input.mode ?? "pipeline";

  const { data: scan } = await admin
    .from("scans")
    .select("id, status, project_id, metrics")
    .eq("id", input.scanId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (!scan || (scan.project_id as string | null) !== input.projectId) {
    return { status: "skipped", reason: "scan_not_found" };
  }
  if (String(scan.status) !== "completed") {
    return { status: "skipped", reason: "scan_not_completed" };
  }

  const { data: existing } = await admin
    .from("production_verdicts")
    .select("id, generated_at")
    .eq("organization_id", input.organizationId)
    .eq("scan_id", input.scanId)
    .maybeSingle();
  if (existing) {
    // Another invocation (e.g. the worker that finished the last engine) may have created the verdict and been cut short before it
    // wrote the evidence record. Complete it ONLY for a verdict created moments ago: historical scans are never rewritten.
    const generatedAt = Date.parse(String((existing as Row).generated_at ?? ""));
    if (
      input.backfillEvidence === true &&
      Number.isFinite(generatedAt) &&
      Date.now() - generatedAt <= VERDICT_EVIDENCE_BACKFILL_WINDOW_MS &&
      !metricsOf(scan as Row)[VERDICT_EVIDENCE_KEY]
    ) {
      // A reconstruction, labelled as one: never presented as what was captured when the verdict was generated.
      await recordVerdictEvidenceSafely(admin, {
        scanId: input.scanId,
        organizationId: input.organizationId,
        mode,
        hasSecurityDecision: isStoredDecision(metricsOf(scan as Row)[STORED_DECISION_KEY]),
        reconstructedAfter: { verdictGeneratedAt: new Date(generatedAt).toISOString() },
      });
    }
    return { status: "already_exists" };
  }

  // Recovery: engines that outlived their own timeout are terminalized EXPLICITLY (TIMED_OUT / REJECTED) first.
  if (mode === "recovery") {
    await sweepAbandonedSecurityJobs(admin, { scanId: input.scanId, organizationId: input.organizationId });
  }

  const { data: jobs, error } = await admin
    .from("security_jobs")
    .select("id, engine, status")
    .eq("scan_id", input.scanId)
    .eq("organization_id", input.organizationId);

  // Unreadable job state must never look like "no engines pending".
  if (error || !jobs) {
    return { status: "deferred", reason: "engines_pending", pendingEngines: ["unknown"] };
  }
  const jobRows = jobs as Row[];

  const { data: scanJobs } = await admin
    .from("scan_jobs")
    .select("status, heartbeat_at, started_at, updated_at, scheduled_at, execution_deadline_at, metadata")
    .eq("scan_id", input.scanId)
    .in("status", ["queued", "running"]);

  const readiness = assessEvidenceReadiness({
    mode,
    jobs: jobRows.map((job) => ({ engine: String(job.engine), status: String(job.status) })),
    evidenceMarkerPresent: typeof metricsOf(scan as Row)[EVIDENCE_READY_KEY] === "string",
    liveScanJobs: (scanJobs ?? []) as Array<Record<string, unknown>> as never,
  });
  if (!readiness.ready) {
    return { status: "deferred", reason: readiness.reason, pendingEngines: readiness.pendingEngines };
  }

  const generate =
    input.generate ??
    (await import("./core")).generateAndPersistProductionVerdict;
  const storedDecision = metricsOf(scan as Row)[STORED_DECISION_KEY];
  const verdict = await generate(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId: input.scanId,
    scanJobId: input.scanJobId ?? null,
    finalizedBy: mode,
    securityDecisionReport:
      input.securityDecisionReport ?? (isStoredDecision(storedDecision) ? storedDecision : null),
  });
  if (!verdict) return { status: "skipped", reason: "verdict_not_generated" };
  // The canonical generator records it already (every path creates verdicts through it); this covers an injected generator.
  await recordVerdictEvidenceSafely(admin, {
    scanId: input.scanId,
    organizationId: input.organizationId,
    mode,
    hasSecurityDecision: Boolean(input.securityDecisionReport) || isStoredDecision(storedDecision),
  });
  return { status: "generated", verdict };
}

/**
 * Which engines contributed to a verdict, recorded next to the scan (scans.metrics.verdictEvidence) at the moment it is
 * generated: engine, final status, whether the platform's security decision was available, and how it was finalized. Nothing
 * here changes the verdict; it documents the evidence it was computed from (a failed or timed-out engine stays visible as such).
 */
export type RecordVerdictEvidenceResult =
  | { recorded: true }
  | { recorded: false; reason: "already_recorded" | "scan_not_found" | "write_failed"; message?: string };

export async function recordVerdictEvidence(
  admin: SupabaseClient,
  input: {
    scanId: string;
    organizationId: string;
    mode: FinalizeMode;
    hasSecurityDecision: boolean;
    /** Set ONLY when the record is written after the verdict was generated: it is then a reconstruction, and says so. */
    reconstructedAfter?: { verdictGeneratedAt: string };
  }
): Promise<RecordVerdictEvidenceResult> {
  const { data: jobs, error: jobsError } = await admin
    .from("security_jobs")
    .select("engine, status")
    .eq("scan_id", input.scanId)
    .eq("organization_id", input.organizationId);
  // Unreadable job state is not "no engines ran": say nothing rather than record "not_run".
  if (jobsError) return { recorded: false, reason: "write_failed", message: jobsError.message };
  const engines = ((jobs ?? []) as Row[]).map((job) => ({ engine: String(job.engine), status: String(job.status) }));

  const result = await mergeScanMetrics(admin, {
    scanId: input.scanId,
    organizationId: input.organizationId,
    // First record wins: it describes the evidence the verdict was computed from; a later call must not rewrite it.
    patch: (current) =>
      current[VERDICT_EVIDENCE_KEY]
        ? null
        : {
            [VERDICT_EVIDENCE_KEY]: input.reconstructedAfter
              ? {
                  // NOT captured when the verdict was generated: rebuilt afterwards from the engine jobs as they are now.
                  capture: "reconstructed_after_verdict",
                  reconstructedAt: new Date().toISOString(),
                  verdictGeneratedAt: input.reconstructedAfter.verdictGeneratedAt,
                  finalizedBy: input.mode,
                  securityDecisionIncluded: input.hasSecurityDecision,
                  externalEngines: engines.length > 0 ? engines : "not_run",
                }
              : {
                  capture: "at_verdict_generation",
                  finalizedAt: new Date().toISOString(),
                  finalizedBy: input.mode,
                  securityDecisionIncluded: input.hasSecurityDecision,
                  externalEngines: engines.length > 0 ? engines : "not_run",
                },
          },
    requireStatus: ["completed"],
  });
  if (!result.ok) {
    if (result.reason === "scan_not_found") return { recorded: false, reason: "scan_not_found" };
    return { recorded: false, reason: "write_failed", message: result.message ?? result.reason };
  }
  return { recorded: true };
}

/**
 * Never throws and never stays silent: a verdict must not fail because its evidence record could not be written, but a missing
 * record has to be visible (structured log), because it is the only place that says which engines the verdict was computed from.
 */
export async function recordVerdictEvidenceSafely(
  admin: SupabaseClient,
  input: Parameters<typeof recordVerdictEvidence>[1]
): Promise<RecordVerdictEvidenceResult> {
  try {
    const result = await recordVerdictEvidence(admin, input);
    if (!result.recorded && result.reason !== "already_recorded") {
      console.warn({ component: "evidence-finalization", event: "verdict_evidence_record_failed", scanId: input.scanId, reason: result.reason, message: result.message });
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn({ component: "evidence-finalization", event: "verdict_evidence_record_failed", scanId: input.scanId, reason: "exception", message });
    return { recorded: false, reason: "write_failed", message };
  }
}

/**
 * Terminalizes engine jobs that outlived their own timeout (+ grace) so nothing blocks a verdict forever and nothing is turned
 * into success: RUNNING -> TIMED_OUT, QUEUED -> REJECTED, both with an explicit error. Optimistic transitions: an engine that
 * finishes meanwhile wins.
 */
export async function sweepAbandonedSecurityJobs(
  admin: SupabaseClient,
  input: { scanId: string; organizationId: string; nowMs?: number }
): Promise<Array<{ engine: string; from: string; to: string }>> {
  const nowMs = input.nowMs ?? Date.now();
  const { data } = await admin
    .from("security_jobs")
    .select("id, engine, status, requested_at, started_at, timeout_ms")
    .eq("scan_id", input.scanId)
    .eq("organization_id", input.organizationId);
  const swept: Array<{ engine: string; from: string; to: string }> = [];
  const { transitionSecurityJob } = await import("@/server/security-jobs/service");
  for (const job of ((data ?? []) as Row[]).filter((row) => PENDING_JOB_STATUSES.has(String(row.status)))) {
    const since = Date.parse(String((job.started_at as string | null) ?? job.requested_at ?? ""));
    if (!Number.isFinite(since)) continue;
    const timeoutMs = Number(job.timeout_ms) > 0 ? Number(job.timeout_ms) : DEFAULT_ENGINE_TIMEOUT_MS;
    if (nowMs - since <= timeoutMs + ENGINE_ABANDON_GRACE_MS) continue;
    const from = String(job.status) as "QUEUED" | "RUNNING";
    const to = from === "RUNNING" ? "TIMED_OUT" : "REJECTED";
    try {
      await transitionSecurityJob(admin, {
        jobId: String(job.id),
        from,
        to,
        error: {
          code: to === "TIMED_OUT" ? "abandoned_timeout" : "queue_expired",
          message: `Engine ${String(job.engine)} did not finish within its budget and was terminalized by verdict recovery`,
        },
      });
      swept.push({ engine: String(job.engine), from, to });
    } catch {
      // another actor moved it first; the next pass re-reads the real state
    }
  }
  return swept;
}

/**
 * Recovery of verdicts that stayed deferred (the worker that would have finalized them never ran): completed scans older than
 * DEFERRED_VERDICT_MIN_AGE_MS without a verdict are finalized in recovery mode (engines already terminal, or terminalized
 * explicitly if abandoned). Bounded and idempotent; never touches a scan that already has a verdict.
 */
export async function recoverDeferredVerdicts(
  admin: SupabaseClient,
  input: { nowMs?: number; lookbackMs?: number; limit?: number } = {}
): Promise<{ examined: number; generated: number; deferred: number }> {
  const nowMs = input.nowMs ?? Date.now();
  const { data: scans } = await admin
    .from("scans")
    .select("id, organization_id, project_id, completed_at")
    .eq("status", "completed")
    .gte("completed_at", new Date(nowMs - (input.lookbackMs ?? 24 * 60 * 60_000)).toISOString())
    .lt("completed_at", new Date(nowMs - DEFERRED_VERDICT_MIN_AGE_MS).toISOString())
    .order("completed_at", { ascending: false })
    .limit(input.limit ?? 50);
  const rows = (scans ?? []) as Row[];
  if (rows.length === 0) return { examined: 0, generated: 0, deferred: 0 };
  const { data: verdicts } = await admin.from("production_verdicts").select("scan_id").in("scan_id", rows.map((row) => row.id));
  const have = new Set(((verdicts ?? []) as Row[]).map((row) => String(row.scan_id)));
  let generated = 0;
  let deferred = 0;
  let examined = 0;
  for (const row of rows.filter((candidate) => !have.has(String(candidate.id)))) {
    examined += 1;
    const outcome = await finalizeVerdictWhenEvidenceComplete(admin, {
      organizationId: String(row.organization_id),
      projectId: String(row.project_id),
      scanId: String(row.id),
      mode: "recovery",
    }).catch(() => null);
    if (outcome?.status === "generated") generated += 1;
    else if (outcome?.status === "deferred") deferred += 1;
  }
  return { examined, generated, deferred };
}

/**
 * Called from every security-job terminal transition. Never throws: a
 * finalization problem must not fail or hang the engine job that triggered it
 * (the runner and later terminal transitions will re-attempt).
 */
export async function finalizeVerdictForTerminalSecurityJob(
  admin: SupabaseClient,
  jobId: string
): Promise<FinalizeOutcome | null> {
  try {
    const { data: job } = await admin
      .from("security_jobs")
      .select("scan_id, organization_id, project_id")
      .eq("id", jobId)
      .maybeSingle();
    if (!job) return null;
    const outcome = await finalizeVerdictWhenEvidenceComplete(admin, {
      organizationId: job.organization_id as string,
      projectId: job.project_id as string,
      scanId: job.scan_id as string,
      mode: "pipeline",
      backfillEvidence: true, // normal finalization (the engine-terminal hook)
    });
    console.info({
      component: "evidence-finalization",
      event: "job_terminal_finalize",
      jobId,
      scanId: job.scan_id,
      status: outcome.status,
      reason: "reason" in outcome ? outcome.reason : undefined,
    });
    return outcome;
  } catch (error) {
    console.error({
      component: "evidence-finalization",
      event: "job_terminal_finalize_failed",
      jobId,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Waits -- bounded, and driven by the real job/verdict state on every
 * iteration -- for a scan's verdict. Each iteration also re-attempts
 * finalization, so a verdict whose triggering event was missed is generated
 * here as soon as the evidence is complete instead of staying absent.
 */
export async function waitForScanVerdict(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    scanId: string;
    maxMs: number;
    intervalMs?: number;
  }
): Promise<FinalizeOutcome> {
  const intervalMs = input.intervalMs ?? 2_000;
  const deadline = Date.now() + input.maxMs;
  for (;;) {
    const outcome = await finalizeVerdictWhenEvidenceComplete(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      scanId: input.scanId,
      mode: "pipeline",
      backfillEvidence: true, // normal finalization (the runner's own wait)
    });
    if (outcome.status !== "deferred") return outcome;
    if (Date.now() + intervalMs >= deadline) return outcome;
    await sleep(intervalMs);
  }
}
