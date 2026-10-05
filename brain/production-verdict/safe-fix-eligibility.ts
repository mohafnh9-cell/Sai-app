import type { ProductionVerdictV1 } from "./schema";

/**
 * "Apply Safe Fix" is an actionable recommendation, so it may only be offered
 * for a real, current, supported finding. This is the single gate; no UI layer
 * may offer Safe Fix from a status or a static string.
 */
export type SafeFixFindingRow = {
  id: string;
  project_id: string;
  scan_id: string;
  status: string | null;
  /** The deterministic remediation text recorded with the finding. */
  recommendation: string | null;
};

export type SafeFixOffer = { title: string; findingCount: number };

export function safeFixOffer(input: {
  projectId: string;
  /** The project's current scan (repository_scan_state.last_scan_id). */
  currentScanId: string | null;
  /** The project's default branch, when known. */
  defaultBranch: string | null;
  verdict: ProductionVerdictV1 | null;
  /** Candidate finding rows (typically fetched by id for the verdict's top priority). */
  findings: SafeFixFindingRow[];
}): SafeFixOffer | null {
  const { verdict } = input;
  if (!verdict) return null;
  // Nothing to fix on a ready verdict (and the Mission Control Safe Fix card is hidden there too).
  if (verdict.status === "ready_to_ship") return null;
  // The verdict must belong to this project and to the current evaluated scan.
  if (verdict.projectId !== input.projectId) return null;
  if (!input.currentScanId || verdict.scanId !== input.currentScanId) return null;
  // Never from another branch: the current verdict is the default branch's.
  if (input.defaultBranch && verdict.branch && verdict.branch !== input.defaultBranch) return null;

  const top = verdict.topPriorities?.[0];
  const ids = new Set(top?.findingIds ?? []);
  if (!top || ids.size === 0) return null;

  const eligible = input.findings.filter(
    (row) =>
      ids.has(row.id) &&
      row.project_id === input.projectId &&
      row.scan_id === verdict.scanId &&
      row.status === "open" &&
      typeof row.recommendation === "string" &&
      row.recommendation.trim().length > 0
  );
  return eligible.length > 0 ? { title: top.title, findingCount: eligible.length } : null;
}
