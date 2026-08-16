import type { InputFile } from "@/features/security-scanner/types";
import { redactEvidence } from "@/features/security-scanner/redaction";
import { isNonBlockingSecretFinding } from "@/brain/production-verdict/secret-classification";
import type { Finding } from "@/features/security-scanner/types";
import type { LocalFindingPublic } from "./types";
import {
  listWorkspaceFiles,
  readWorkspaceTextFile,
} from "./workspace";

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

  return {
    id: finding.id,
    ruleId: finding.ruleId,
    title: finding.title,
    description: finding.description,
    severity: finding.severity,
    category: finding.category,
    filePath: finding.location.path,
    line: finding.location.line,
    correlationKey: finding.correlationKey,
    evidence: finding.evidence ? redactEvidence(finding.evidence) : undefined,
    remediation: finding.remediation,
    confidence: finding.confidence,
    safeToIgnore,
  };
}

export function mapFindingsToPublic(findings: Finding[]): LocalFindingPublic[] {
  return findings.map(mapFindingToPublic);
}
