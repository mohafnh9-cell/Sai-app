import type { AttackPreconditions } from "../findings/finding.types";
import type { AIFinding } from "../findings/finding.types";

/** Canonical attack preconditions — always sourced from RT10 findings (never recomputed downstream). */
export type CanonicalAttackPreconditionRecord = {
  findingId: string;
  preconditionsId: string;
  preconditions: AttackPreconditions;
};

export function exportAttackPreconditionsFromFindings(
  findings: AIFinding[]
): CanonicalAttackPreconditionRecord[] {
  return findings.map((f) => ({
    findingId: f.findingId,
    preconditionsId: f.traceability.attackPreconditionsId,
    preconditions: f.attackPreconditions,
  }));
}

export type AttackPreconditionsSummary = {
  count: number;
  byCapability: Record<string, number>;
  records: CanonicalAttackPreconditionRecord[];
};

export function summarizeAttackPreconditions(findings: AIFinding[]): AttackPreconditionsSummary {
  const records = exportAttackPreconditionsFromFindings(findings);
  const byCapability: Record<string, number> = {};
  for (const r of records) {
    const cap = r.preconditions.requiredAttackerCapability;
    byCapability[cap] = (byCapability[cap] ?? 0) + 1;
  }
  return { count: records.length, byCapability, records };
}
