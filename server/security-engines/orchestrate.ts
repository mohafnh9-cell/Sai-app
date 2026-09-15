import "server-only";

import type { EngineExecutionStatus, EngineResult, SecurityEngine } from "./types";
import { listExternalAndNativeAdjacentEngines } from "./registry";
import type { SequrAIFinding, CanonicalEvidence } from "@/server/security-evidence/canonical-finding";

/**
 * Phase 35, section 27: ONE execution path for these engines -- callable
 * from the central scan pipeline (currently wired only into
 * server/full-product-audit/orchestrate.ts, see Phase 35 final report
 * section "Architecture After" for the exact scoping decision and why). Not
 * hardcoded separately into the webhook, GitHub route, MCP route, or
 * dashboard route.
 *
 * Section 22: an engine's own failure is represented in its EngineResult and
 * surfaced in the coverage report -- it never silently becomes "this engine
 * found nothing" to a caller that only reads `.findings`.
 */
export type RunSecurityEnginesInput = {
  scanId: string;
  projectId: string;
  organizationId: string;
  files: Array<{ path: string; content: string }>;
  githubRepo?: string | null;
  timeoutMs?: number;
  /** L1.4: optional, backward-compatible external cancellation, passed straight through to each engine.execute(). */
  signal?: AbortSignal;
};

export type RunSecurityEnginesOutput = {
  results: EngineResult[];
  findings: SequrAIFinding[];
  evidence: CanonicalEvidence[];
};

const DEFAULT_TIMEOUT_MS = 60_000;

export async function runSecurityEngines(
  input: RunSecurityEnginesInput,
  engines: SecurityEngine[] = listExternalAndNativeAdjacentEngines()
): Promise<RunSecurityEnginesOutput> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const applicabilityInput = { files: input.files, githubRepo: input.githubRepo };

  // Independent engines -- run in parallel (section 34: "future architecture
  // may execute independent engines in parallel" -- there is no cross-engine
  // dependency here, so this phase already does it, not deferred further).
  const results = await Promise.all(
    engines.map(async (engine): Promise<EngineResult> => {
      const applicability = engine.applicability(applicabilityInput);
      if (!applicability.applicable) {
        return {
          engine: engine.id,
          engineVersion: engine.version,
          executionId: `${engine.id}-skipped`,
          scanId: input.scanId,
          projectId: input.projectId,
          organizationId: input.organizationId,
          status: "SKIPPED",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 0,
          capabilitiesAttempted: [],
          capabilitiesCompleted: [],
          findings: [],
          evidence: [],
          metrics: {},
          errors: [{ code: "not_applicable", message: applicability.reason }],
        };
      }

      if (input.signal?.aborted) {
        return {
          engine: engine.id,
          engineVersion: engine.version,
          executionId: `${engine.id}-cancelled`,
          scanId: input.scanId,
          projectId: input.projectId,
          organizationId: input.organizationId,
          status: "SKIPPED",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 0,
          capabilitiesAttempted: [],
          capabilitiesCompleted: [],
          findings: [],
          evidence: [],
          metrics: {},
          errors: [{ code: "cancelled", message: "Cancelled before this engine started." }],
        };
      }

      try {
        return await engine.execute({
          scanId: input.scanId,
          projectId: input.projectId,
          organizationId: input.organizationId,
          files: input.files,
          githubRepo: input.githubRepo,
          timeoutMs,
          signal: input.signal,
        });
      } catch (error) {
        return {
          engine: engine.id,
          engineVersion: engine.version,
          executionId: `${engine.id}-crashed`,
          scanId: input.scanId,
          projectId: input.projectId,
          organizationId: input.organizationId,
          status: "FAILED",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 0,
          capabilitiesAttempted: [],
          capabilitiesCompleted: [],
          findings: [],
          evidence: [],
          metrics: {},
          errors: [{ code: "engine_crashed", message: error instanceof Error ? error.message : String(error) }],
        };
      }
    })
  );

  return {
    results,
    findings: results.flatMap((r) => r.findings),
    evidence: results.flatMap((r) => r.evidence),
  };
}

/**
 * Section 23: a structured, factual coverage report -- never "100% secure",
 * never a status the engine itself didn't earn.
 */
export type SecurityCoverageEntry = { engine: string; status: EngineExecutionStatus; reason?: string };

export function buildSecurityCoverageReport(results: EngineResult[]): SecurityCoverageEntry[] {
  return results.map((r) => ({
    engine: r.engine,
    status: r.status,
    reason: r.errors[0]?.message,
  }));
}
