import { createHash } from "node:crypto";
import { guardUntrustedInput } from "@/server/mcp/security";
import { AI_REASONING_VERSION } from "./schema";

export type ScanFindingRow = {
  id: string;
  title: string;
  severity: string | null;
  category: string | null;
  rule_id: string | null;
  file_path: string | null;
  start_line: number | null;
  recommendation: string | null;
  confidence: string | null;
  evidence: string | null;
};

/** Bounded, prompt-injection-guarded evidence for a single Category C finding. */
export type BoundedFindingEvidence = {
  findingId: string;
  ruleId: string;
  severity: string;
  confidence: string;
  category: string;
  filePath: string | null;
  line: number | null;
  /** Already redacted at scan time (scanner.ts:finalizeFinding); wrapped again here for prompt safety. */
  evidence: string | undefined;
  description: string | undefined;
  recommendation: string | undefined;
};

// Hard bounds -- Phase 30 requirement: repository size must never create an
// unbounded Claude request. These are deliberately small: Category C
// findings are rare per scan, and each one only carries scanner-produced
// text (never re-fetched file content), so real requests stay far below
// these ceilings in practice.
export const MAX_FINDINGS_PER_REASONING_CALL = 12;
const MAX_FIELD_CHARS = 600;

function bound(value: string | null | undefined, max = MAX_FIELD_CHARS): string | undefined {
  if (!value) return undefined;
  const trimmed = value.length > max ? `${value.slice(0, max)}…` : value;
  return guardUntrustedInput(trimmed, { source: "finding_field", path: "ai-reasoning", forceWrap: true }).forPrompt;
}

/**
 * Builds the bounded, guarded evidence bundle sent to Claude. Only Category
 * C findings should ever be passed in -- callers are responsible for that
 * filter (features/security-scanner/rules/ai-reasoning-classification.ts).
 */
export function buildBoundedEvidence(findings: ScanFindingRow[]): BoundedFindingEvidence[] {
  return findings.slice(0, MAX_FINDINGS_PER_REASONING_CALL).map((finding) => ({
    findingId: finding.id,
    ruleId: finding.rule_id ?? "unknown",
    severity: (finding.severity ?? "medium").toLowerCase(),
    confidence: (finding.confidence ?? "medium").toLowerCase(),
    category: (finding.category ?? "general").toLowerCase(),
    filePath: finding.file_path,
    line: finding.start_line,
    evidence: bound(finding.evidence),
    description: bound(finding.title),
    recommendation: bound(finding.recommendation),
  }));
}

/**
 * Stable cache/invalidation key: reasoning version + every analyzed
 * finding's id and rule id, sorted. Changing which Category C findings exist
 * for a scan (new one appears, one disappears, a rule/version changes)
 * always changes this hash -- stale reasoning is never silently reused
 * (Phase 30 requirement O).
 */
export function computeEvidenceHash(findings: ScanFindingRow[]): string {
  const material = findings
    .map((f) => `${f.id}:${f.rule_id ?? ""}`)
    .sort()
    .join("|");
  return createHash("sha256").update(`${AI_REASONING_VERSION}::${material}`).digest("hex");
}
