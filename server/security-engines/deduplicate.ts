import "server-only";

import { randomUUID } from "node:crypto";
import type { SequrAIFinding } from "@/server/security-evidence/canonical-finding";
import type { FindingCorrelationGroup } from "@/server/ai-red-team/intelligence/models";

/**
 * Phase 35, sections 8/24/32: cross-engine deduplication for STATIC findings
 * (native regex rules vs. OpenGrep AST/taint vs. crypto engine). This is
 * genuinely new logic -- the existing correlation-engine.ts
 * (server/ai-red-team/intelligence/) only ever correlates DYNAMIC attack-
 * simulation observations against each other (verified during the Phase 34
 * audit); it has never seen a static finding. Reusing that engine's output
 * SCHEMA (FindingCorrelationGroup, persisted into the same
 * finding_correlations table from migration 061) rather than inventing a
 * new correlation table/system satisfies "do not create a second
 * correlation system" -- but the matching logic itself has to be new.
 *
 * Deliberately conservative (section 8): same title / same CWE / same file
 * alone is NOT sufficient to merge. Requires overlapping location (same
 * file, line numbers within LINE_PROXIMITY of each other) AND a shared
 * vulnerability category. Anything short of that stays separate.
 */

const LINE_PROXIMITY = 5;

function extractLine(finding: SequrAIFinding): number | null {
  const detail = finding.evidence[0]?.detail;
  if (!detail) return null;
  try {
    const parsed = JSON.parse(detail) as { location?: { line?: number } };
    return parsed.location?.line ?? null;
  } catch {
    return null;
  }
}

function sameVulnerabilityClass(a: SequrAIFinding, b: SequrAIFinding): boolean {
  if (a.category !== b.category) return false;
  const aCwe = new Set(a.cwe);
  const bCwe = new Set(b.cwe);
  if (aCwe.size === 0 || bCwe.size === 0) return a.category === b.category; // category match is the fallback signal when neither has a CWE
  return [...aCwe].some((c) => bCwe.has(c));
}

export function crossEngineDeduplication(findings: SequrAIFinding[]): FindingCorrelationGroup[] {
  const groups: FindingCorrelationGroup[] = [];
  const merged = new Set<string>();

  for (let i = 0; i < findings.length; i += 1) {
    const a = findings[i];
    if (!a || merged.has(a.id)) continue;

    const cluster: SequrAIFinding[] = [a];
    for (let j = i + 1; j < findings.length; j += 1) {
      const b = findings[j];
      if (!b || merged.has(b.id)) continue;
      if (a.sources.some((s) => b.sources.includes(s)) && a.sources.length === 1 && b.sources.length === 1 && a.sources[0] === b.sources[0]) {
        // Same single engine reporting twice is a within-engine duplicate
        // concern, not cross-engine correlation -- out of scope here.
        continue;
      }
      if (a.affectedFiles.length === 0 || b.affectedFiles.length === 0) continue;
      if (!a.affectedFiles.some((f) => b.affectedFiles.includes(f))) continue;
      if (!sameVulnerabilityClass(a, b)) continue;

      const lineA = extractLine(a);
      const lineB = extractLine(b);
      // Both findings must carry a resolvable line number within proximity --
      // "insufficient confidence" (no line evidence on either side) means
      // keep separate, per section 8, rather than merging on file+class alone.
      if (lineA == null || lineB == null || Math.abs(lineA - lineB) > LINE_PROXIMITY) continue;

      cluster.push(b);
      merged.add(b.id);
    }

    if (cluster.length > 1) {
      merged.add(a.id);
      groups.push({
        id: randomUUID(),
        kind: "same_issue",
        findingIds: cluster.map((f) => f.id),
        confidence: 0.75,
        rationale: `${cluster.length} engines (${[...new Set(cluster.flatMap((f) => f.sources))].join(", ")}) independently flagged the same vulnerability class in the same location.`,
      });
    }
  }

  return groups;
}
