import type { FindingDraft } from "@/features/security-scanner/types";
import type { ExternalSecuritySourceTool } from "./constants";
import {
  normalizeExternalFinding,
  normalizeExternalFindings,
  type NormalizeExternalFindingOptions,
} from "./normalize-external-finding";
import type { SecurityAnalysisFinding } from "./schema";
import {
  securityAnalysisFindingToDraft,
  securityAnalysisFindingsToDrafts,
} from "./to-finding-draft";

/**
 * Adapter entry point for external security engine output.
 * Converts raw agent-security-scanner-mcp findings into SequrAI FindingDraft objects
 * ready for the existing scan pipeline (finalizeFinding → enrich → persist → verdict).
 */
export function externalFindingsToSecurityAnalysis(
  findings: unknown,
  sourceTool: ExternalSecuritySourceTool,
  options?: NormalizeExternalFindingOptions
): SecurityAnalysisFinding[] {
  return normalizeExternalFindings(findings, sourceTool, options);
}

export function externalFindingsToDrafts(
  findings: unknown,
  sourceTool: ExternalSecuritySourceTool,
  options?: NormalizeExternalFindingOptions
): FindingDraft[] {
  return securityAnalysisFindingsToDrafts(
    externalFindingsToSecurityAnalysis(findings, sourceTool, options)
  );
}

export function externalFindingToDraft(
  finding: unknown,
  sourceTool: ExternalSecuritySourceTool,
  options?: NormalizeExternalFindingOptions
): FindingDraft | null {
  const normalized = normalizeExternalFinding(finding, sourceTool, options);
  return normalized ? securityAnalysisFindingToDraft(normalized) : null;
}

/**
 * Merge external drafts into an existing scan draft list without duplicating rule/file/line matches.
 */
export function mergeExternalFindingDrafts(
  existing: FindingDraft[],
  external: FindingDraft[]
): FindingDraft[] {
  const seen = new Set(
    existing.map(
      (finding) =>
        `${finding.ruleId}|${finding.location.path}|${finding.location.line}|${finding.title}`
    )
  );
  const merged = [...existing];
  for (const finding of external) {
    const key = `${finding.ruleId}|${finding.location.path}|${finding.location.line}|${finding.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(finding);
  }
  return merged;
}
