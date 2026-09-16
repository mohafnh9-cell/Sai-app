import type { InputFile } from "@/features/security-scanner/types";
import { redactEvidence } from "@/features/security-scanner/redaction";
import { isNonBlockingSecretFinding } from "@/brain/production-verdict/secret-classification";
import type { Finding } from "@/features/security-scanner/types";
import type { LocalFindingPublic } from "./types";
import { guardUntrustedInput } from "@/server/mcp/security";
import {
  listWorkspaceFiles,
  readWorkspaceTextFile,
} from "./workspace";

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

export function collectInputFiles(
  workspaceRoot: string,
  onlyRelativePaths?: Set<string>
): InputFile[] {
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
  return files;
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

export function mapFindingToPublic(finding: Finding): LocalFindingPublic {
  const safeToIgnore = isNonBlockingSecretFinding({
    ruleId: finding.ruleId,
    file_path: finding.location.path,
    evidence: finding.evidence ?? null,
    metadata: finding.metadata ?? null,
  });

  const path = finding.location.path;
  const redactedEvidence = finding.evidence ? redactEvidence(finding.evidence) : undefined;

  return {
    id: finding.id,
    ruleId: finding.ruleId,
    title: guardFindingText(finding.title, path, "title"),
    description: guardFindingText(finding.description, path, "description"),
    severity: finding.severity,
    category: finding.category,
    filePath: path,
    line: finding.location.line,
    correlationKey: finding.correlationKey,
    evidence: redactedEvidence ? guardFindingText(redactedEvidence, path, "evidence") : undefined,
    remediation: guardFindingText(finding.remediation, path, "remediation"),
    confidence: finding.confidence,
    safeToIgnore,
  };
}

export function mapFindingsToPublic(findings: Finding[]): LocalFindingPublic[] {
  return findings.map(mapFindingToPublic);
}
