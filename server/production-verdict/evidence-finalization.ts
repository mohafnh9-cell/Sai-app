import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import type { SecurityDecisionFinalizeInput } from "@/brain/production-verdict/finalize-verdict";

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

const PENDING_JOB_STATUSES = new Set(["QUEUED", "RUNNING"]);

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
  const { data: scan } = await admin
    .from("scans")
    .select("id, metrics")
    .eq("id", input.scanId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (!scan) throw new Error(`Cannot mark evidence ready: scan ${input.scanId} not found`);

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

  const { error } = await admin
    .from("scans")
    .update({
      metrics: {
        ...metricsOf(scan as Row),
        [EVIDENCE_READY_KEY]: new Date().toISOString(),
        [STORED_DECISION_KEY]: stored,
      },
    })
    .eq("id", input.scanId)
    .eq("organization_id", input.organizationId);
  if (error) throw new Error(`Could not mark verdict evidence ready: ${error.message}`);
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
    /** Injectable for tests; defaults to the canonical generator. */
    generate?: (
      admin: SupabaseClient,
      input: {
        organizationId: string;
        projectId: string;
        scanId: string;
        scanJobId?: string | null;
        securityDecisionReport?: SecurityDecisionFinalizeInput | null;
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
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("scan_id", input.scanId)
    .maybeSingle();
  if (existing) return { status: "already_exists" };

  if (mode === "pipeline") {
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
    const metrics = metricsOf(scan as Row);
    const evidenceReady = typeof metrics[EVIDENCE_READY_KEY] === "string";

    // A scan with engine jobs is a full pipeline scan: its own stages (which
    // create the jobs and contribute attack-simulation evidence) must be done.
    if (jobRows.length > 0 && !evidenceReady) {
      return { status: "deferred", reason: "evidence_not_ready", pendingEngines: [] };
    }

    const pending = jobRows
      .filter((job) => PENDING_JOB_STATUSES.has(String(job.status)))
      .map((job) => String(job.engine));
    if (pending.length > 0) {
      return { status: "deferred", reason: "engines_pending", pendingEngines: pending };
    }
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
    securityDecisionReport:
      input.securityDecisionReport ?? (isStoredDecision(storedDecision) ? storedDecision : null),
  });
  if (!verdict) return { status: "skipped", reason: "verdict_not_generated" };
  return { status: "generated", verdict };
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
    return await finalizeVerdictWhenEvidenceComplete(admin, {
      organizationId: job.organization_id as string,
      projectId: job.project_id as string,
      scanId: job.scan_id as string,
      mode: "pipeline",
    });
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
    });
    if (outcome.status !== "deferred") return outcome;
    if (Date.now() + intervalMs >= deadline) return outcome;
    await sleep(intervalMs);
  }
}
