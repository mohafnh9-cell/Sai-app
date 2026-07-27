import type { CoreFinding } from "./finding.types";

export type FindingQualityIssue = { code: string; message: string };

/** Reject findings that lack evidence or traceability (stabilization gate). */
export function validateFindingQuality(finding: CoreFinding): FindingQualityIssue[] {
  const issues: FindingQualityIssue[] = [];
  if (!finding.findingId || !finding.findingKey) {
    issues.push({ code: "missing_stable_id", message: "Finding requires stable id and key." });
  }
  if (!finding.category) {
    issues.push({ code: "missing_category", message: "Finding category is required." });
  }
  if (!finding.evidence?.length) {
    issues.push({ code: "missing_evidence", message: "Findings must be evidence-backed." });
  }
  if (!finding.correlation?.keys?.length) {
    issues.push({ code: "missing_correlation", message: "Finding correlation keys required." });
  }
  if (!finding.impact?.affectedAssets?.length) {
    issues.push({ code: "missing_protected_asset", message: "Affected assets must be declared." });
  }
  if (finding.metadata?.executionMode === "discovery_only") {
    issues.push({ code: "discovery_only", message: "Discovery-only findings are rejected." });
  }
  return issues;
}
