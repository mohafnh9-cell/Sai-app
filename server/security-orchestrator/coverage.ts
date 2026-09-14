import "server-only";

import type { EngineResult, EngineId } from "@/server/security-engines/types";
import type { CoverageReport, EngineCoverageEntry, EngineOutcomeStatus, SecurityPlan } from "./types";

/**
 * Phase 36, section 8/21/60: the six outcome states stay distinct all the
 * way to the final coverage report -- never collapse "engine wasn't
 * available" into "engine ran clean."
 */
function classifyOutcome(input: { selected: boolean; result?: EngineResult }): EngineOutcomeStatus {
  if (!input.selected) return "NOT_APPLICABLE";
  if (!input.result) return "UNAVAILABLE";
  switch (input.result.status) {
    case "SKIPPED":
      return "SKIPPED";
    case "FAILED":
      return "FAILED";
    case "COMPLETED":
    case "PARTIAL":
      return input.result.findings.length > 0 ? "COMPLETED_WITH_FINDINGS" : "COMPLETED_CLEAN";
    default:
      return "UNAVAILABLE";
  }
}

export function buildCoverageReport(plan: SecurityPlan, results: Map<EngineId, EngineResult>): CoverageReport {
  const entries: EngineCoverageEntry[] = plan.decisions.map((decision) => {
    const result = results.get(decision.engine);
    const status = classifyOutcome({ selected: decision.selected, result });
    return {
      engine: decision.engine,
      planned: true,
      applicable: decision.selected,
      status,
      findingsCount: result?.findings.length ?? 0,
    };
  });

  const applicable = entries.filter((e) => e.applicable);
  return {
    planned: entries.length,
    applicable: applicable.length,
    executed: applicable.filter((e) => e.status === "COMPLETED_CLEAN" || e.status === "COMPLETED_WITH_FINDINGS" || e.status === "FAILED").length,
    clean: entries.filter((e) => e.status === "COMPLETED_CLEAN").length,
    withFindings: entries.filter((e) => e.status === "COMPLETED_WITH_FINDINGS").length,
    failed: entries.filter((e) => e.status === "FAILED").length,
    unavailable: entries.filter((e) => e.status === "UNAVAILABLE").length,
    skipped: entries.filter((e) => e.status === "SKIPPED").length,
    entries,
  };
}
