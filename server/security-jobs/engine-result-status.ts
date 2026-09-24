import type { EngineResult } from "@/server/security-engines/types";
import type { SecurityJobStatus } from "./types";

/**
 * How an engine's own result becomes the security job's terminal status.
 *
 * Contract: a job is COMPLETED only when the engine's evidence is complete.
 * The job status model has no PARTIAL state (and adding one needs a schema
 * change), so a PARTIAL engine result -- the engine ran but some of its
 * inputs failed or were skipped (opengrep: files that failed to scan; trivy:
 * files skipped as unsafe) -- is recorded as FAILED with the stable error code
 * below. It stays distinguishable from a crash by that code and by the
 * engine_executions row, which persists the engine's own PARTIAL status.
 * Nothing here may ever turn PARTIAL into COMPLETED: doing so made
 * incomplete evidence read as complete coverage.
 */
export const ENGINE_PARTIAL_ERROR_CODE = "engine_partial";

/**
 * Logged by the worker at startup so a running deployment can prove which
 * lifecycle rules it contains (the worker is deployed separately from Vercel
 * and does not report a git commit).
 */
export const WORKER_LIFECYCLE_VERSION = "pass4b:partial-is-incomplete+terminal-job-finalize";

export type JobOutcome = {
  status: Extract<SecurityJobStatus, "COMPLETED" | "FAILED" | "TIMED_OUT" | "CANCELLED">;
  error: { code: string; message: string } | null;
};

export function jobOutcomeFromEngineResult(
  result: Pick<EngineResult, "status" | "errors">
): JobOutcome {
  const first = result.errors[0];

  switch (result.status) {
    case "COMPLETED":
      return { status: "COMPLETED", error: null };

    case "PARTIAL":
      return {
        status: "FAILED",
        error: {
          code: ENGINE_PARTIAL_ERROR_CODE,
          message: first
            ? `Engine evidence is incomplete (${result.errors.length} error(s)); first: ${first.code}: ${first.message}`
            : "Engine evidence is incomplete",
        },
      };

    case "FAILED":
      if (first?.code === "timeout") return { status: "TIMED_OUT", error: first };
      if (first?.code === "cancelled") return { status: "CANCELLED", error: first };
      return { status: "FAILED", error: first ?? { code: "unknown", message: "engine did not complete" } };

    // SKIPPED reaching the worker means the engine's binary genuinely was not
    // available on this worker, and QUEUED/RUNNING are not results at all.
    default:
      return {
        status: "FAILED",
        error: first ?? { code: "engine_not_completed", message: `engine returned ${result.status}` },
      };
  }
}
