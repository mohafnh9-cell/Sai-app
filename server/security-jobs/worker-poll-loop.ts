import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { claimNextSecurityJob } from "./service";
import { runClaimedSecurityJob } from "./worker-run-job";
import { WORKER_CONFIG } from "./worker-config";

/**
 * Phase 35.5, section 31/52: pull, not push. The worker polls this table
 * for QUEUED rows rather than exposing an HTTP endpoint Vercel calls into
 * -- see the architecture decision in the Phase 35.5 report. Enforces
 * MAX_CONCURRENT_JOBS (section 59) so the worker never accepts unlimited
 * concurrent work.
 */
export function createPollLoop(admin: SupabaseClient, options: { signal: AbortSignal }) {
  let inFlight = 0;
  let stopped = false;

  async function tick() {
    if (stopped || inFlight >= WORKER_CONFIG.maxConcurrentJobs) return;
    const job = await claimNextSecurityJob(admin, WORKER_CONFIG.workerId).catch((error) => {
      console.error({ component: "security-worker", event: "claim_failed", message: error instanceof Error ? error.message : String(error) });
      return null;
    });
    if (!job) return;

    inFlight += 1;
    console.info({
      component: "security-worker",
      event: "job_started",
      jobId: job.id,
      scanId: job.scanId,
      organizationId: job.organizationId,
      engine: job.engine,
      engineVersion: job.engineVersion,
      attempt: job.attempt,
    });

    runClaimedSecurityJob(admin, job)
      .then((result) => {
        console.info({
          component: "security-worker",
          event: "job_finished",
          jobId: job.id,
          scanId: job.scanId,
          engine: job.engine,
          status: result.status,
        });
      })
      .catch((error) => {
        console.error({
          component: "security-worker",
          event: "job_crashed",
          jobId: job.id,
          scanId: job.scanId,
          engine: job.engine,
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        inFlight -= 1;
      });
  }

  async function start() {
    options.signal.addEventListener("abort", () => {
      stopped = true;
    });
    while (!stopped) {
      await tick();
      await new Promise((r) => setTimeout(r, WORKER_CONFIG.pollIntervalMs));
    }
  }

  return { start, currentInFlight: () => inFlight };
}
