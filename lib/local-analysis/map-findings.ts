import type { InputFile } from "@/features/security-scanner/types";
import { redactEvidence } from "@/features/security-scanner/redaction";
import { isNonBlockingSecretFinding } from "@/brain/production-verdict/secret-classification";
import type { Finding } from "@/features/security-scanner/types";
import { buildFindingCorrelationKeyFromParts } from "@/lib/correlation/finding-identity";
import type { VerdictEngineInput } from "@/brain/production-verdict/engine";
import type { LocalFindingPublic } from "./types";
import { guardUntrustedInput } from "@/server/mcp/security";
import {
  listWorkspaceFiles,
  readWorkspaceTextFile,
  type WorkspaceListing,
} from "./workspace";

type VerdictFinding = VerdictEngineInput["findings"][number];

/**
 * Core hardening audit (F2): finding title/description/remediation/evidence
 * are repository-controlled free text (a rule's own message plus, for
 * evidence, the matched source line) that reaches the calling agent
 * verbatim through sequrai_local_findings/audit/fix -- previously guarded
 * against secret leakage (redactEvidence) but not against prompt-injection
 * patterns, unlike the fix-prompt path (server/mcp/security's
 * sanitizeProductionFixPromptInput), which already runs every field through
 * this exact guard. Reused here rather than a second injection scanner.
 * Not force-wrapped: text is left untouched unless scanInjectionPatterns
 * actually finds something suspicious, so the common case stays unchanged.
 */
function guardFindingText(value: string, path: string, field: string): string {
  if (!value) return value;
  return guardUntrustedInput(value, { source: "finding_field", path: `${path}#${field}` }).forPrompt;
}

/**
 * F9: returns the workspace listing alongside the read file contents so a
 * caller that also needs listing stats (filesExcluded, discoveredFiles,
 * credentialsSkipped, truncated -- everything lib/local-analysis's MCP
 * response shapes surface) never has to call listWorkspaceFiles() a second
 * time to get them. Previously each of this function's two callers
 * (local-orchestrator.ts and, before F9, run-local-verdict.ts directly)
 * only wanted the file contents, so the listing was silently discarded --
 * fine until a caller ALSO needed the stats, which would have meant walking
 * the workspace twice.
 */
export function collectInputFiles(
  workspaceRoot: string,
  onlyRelativePaths?: Set<string>
): { files: InputFile[]; listing: WorkspaceListing } {
  const listing = listWorkspaceFiles(workspaceRoot, {
    onlyRelativePaths: onlyRelativePaths && onlyRelativePaths.size > 0 ? onlyRelativePaths : undefined,
  });

  const files: InputFile[] = [];
  for (const file of listing.files) {
    try {
      const content = readWorkspaceTextFile(workspaceRoot, file.relativePath);
      files.push({ path: file.relativePath, content });
    } catch {
      continue;
    }
  }
  return { files, listing };
}

export function mapScanFindingToVerdictInput(finding: Finding) {
  return {
    id: finding.id,
    title: finding.title,
    severity: finding.severity,
    category: finding.category,
    rule_id: finding.ruleId,
    file_path: finding.location.path,
    start_line: finding.location.line,
    recommendation: finding.remediation,
    confidence: finding.confidence,
    evidence: finding.evidence ?? null,
    metadata: finding.metadata ?? null,
  };
}

/**
 * F9: the MCP-facing mapper for the orchestrator's unified VerdictFinding
 * shape -- covers BOTH native and external-engine (OpenGrep/Trivy/crypto/
 * Scorecard) findings with one function, since both now flow through
 * runLocalSecurityOrchestrator()'s single findings array. Replaces the old
 * native-only mapFindingToPublic (removed -- it operated on the pre-
 * orchestrator features/security-scanner Finding shape, which nothing calls
 * directly anymore now that run-local-verdict.ts delegates to the
 * orchestrator instead of calling scanRepository() itself).
 *
 * correlationKey reuses the exact same fallback finding-history.ts and
 * local-safe-fix.ts already rely on (metadata.correlationKey when present --
 * always true for native findings -- else recomputed from rule_id/file_path/
 * title) -- never a second identity scheme.
 *
 * description has no dedicated field on VerdictFinding (lost once a native
 * Finding is flattened by mapScanFindingToVerdictInput, and external engines
 * never had a separate description to begin with) -- falls back to
 * recommendation, then title, matching the same honest tradeoff already
 * documented in local-safe-fix.ts's fixPromptInputFromFinding usage.
 */
export function mapVerdictFindingToPublic(finding: VerdictFinding): LocalFindingPublic {
  const ruleId = finding.rule_id ?? "";
  const filePath = finding.file_path ?? null;
  const severity = finding.severity ?? "info";
  const category = finding.category ?? "security";
  const confidence = typeof finding.confidence === "string" ? finding.confidence : finding.confidence != null ? String(finding.confidence) : "low";
  const remediationText = finding.recommendation ?? "";

  const safeToIgnore = isNonBlockingSecretFinding({
    ruleId,
    file_path: filePath,
    evidence: finding.evidence ?? null,
    metadata: finding.metadata ?? null,
  });

  const correlationKey = buildFindingCorrelationKeyFromParts({
    ruleId,
    filePath: filePath ?? "",
    title: finding.title,
    metadata: finding.metadata ?? null,
  });

  const guardPath = filePath ?? ruleId;
  const redactedEvidence = finding.evidence ? redactEvidence(finding.evidence) : undefined;

  return {
    id: finding.id ?? `${ruleId}:${correlationKey}`,
    ruleId,
    title: guardFindingText(finding.title, guardPath, "title"),
    description: guardFindingText(remediationText || finding.title, guardPath, "description"),
    severity,
    category,
    filePath,
    line: finding.start_line ?? null,
    correlationKey,
    evidence: redactedEvidence ? guardFindingText(redactedEvidence, guardPath, "evidence") : undefined,
    remediation: guardFindingText(remediationText, guardPath, "remediation"),
    confidence,
    safeToIgnore,
  };
}

export function mapVerdictFindingsToPublic(findings: VerdictFinding[]): LocalFindingPublic[] {
  return findings.map(mapVerdictFindingToPublic);
}
