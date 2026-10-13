import { isScanJobAbandoned, type ScanJobActivityFields } from "@/server/jobs/orphan-policy";

/**
 * THE signal that a scan's evidence is ready to be turned into its (immutable) Production Verdict.
 *
 * Normal pipeline (the scan's own runner is alive):
 *   - the runner has written `verdictEvidenceReadyAt` (its native scan, red team, orchestration and attack phase are finished,
 *     and the engine jobs it created exist), AND
 *   - no engine job is QUEUED or RUNNING (each is terminal: COMPLETED, FAILED, TIMED_OUT, CANCELLED or REJECTED).
 *   A scan with no engine jobs and no marker is ready only if no live scan job could still be about to create them.
 * Recovery (the runner is gone -- verified by the job's own silence): no marker is needed, but every engine job must still be
 *   terminal; engines that outlived their own timeout are terminalized first (explicitly, never as success).
 *
 * A failed or timed-out engine is TERMINAL: it makes the evidence ready, and the verdict reports it as missing evidence
 * (insufficient_data) rather than hiding it. Pure: no I/O, so every branch is unit-tested.
 */
export const PENDING_ENGINE_STATUSES: ReadonlySet<string> = new Set(["QUEUED", "RUNNING"]);

export type EvidenceReadinessInput = {
  mode: "pipeline" | "recovery";
  jobs: Array<{ engine: string; status: string }>;
  evidenceMarkerPresent: boolean;
  /** Scan jobs (not engine jobs) of this scan that are queued/running. */
  liveScanJobs: ScanJobActivityFields[];
  nowMs?: number;
};

export type EvidenceReadiness =
  | { ready: true }
  | { ready: false; reason: "evidence_not_ready" | "engines_pending"; pendingEngines: string[] };

export function assessEvidenceReadiness(input: EvidenceReadinessInput): EvidenceReadiness {
  const pending = input.jobs.filter((job) => PENDING_ENGINE_STATUSES.has(String(job.status))).map((job) => String(job.engine));

  if (input.mode === "recovery") {
    return pending.length > 0 ? { ready: false, reason: "engines_pending", pendingEngines: pending } : { ready: true };
  }

  if (input.jobs.length > 0 && !input.evidenceMarkerPresent) {
    return { ready: false, reason: "evidence_not_ready", pendingEngines: [] };
  }
  if (pending.length > 0) return { ready: false, reason: "engines_pending", pendingEngines: pending };

  if (input.jobs.length === 0 && !input.evidenceMarkerPresent) {
    // No engine job exists YET. If the scan's own job is still alive it may be about to create them: not ready.
    const stillAlive = input.liveScanJobs.some((job) => !isScanJobAbandoned(job, input.nowMs));
    if (stillAlive) return { ready: false, reason: "evidence_not_ready", pendingEngines: [] };
  }
  return { ready: true };
}
