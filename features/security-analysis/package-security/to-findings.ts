import { AGENT_SECURITY_SCANNER_ID } from "../constants";
import { normalizeExternalFinding } from "../normalize-external-finding";
import type { SecurityAnalysisFinding } from "../schema";
import { PACKAGE_SECURITY_CATEGORY_REMEDIATION, PACKAGE_SECURITY_SOURCE_TOOL } from "./constants";
import type { PackageSecurityRawFinding } from "./types";

function remediationFor(finding: PackageSecurityRawFinding): string {
  return (
    PACKAGE_SECURITY_CATEGORY_REMEDIATION[finding.category] ??
    "Review this dependency declaration and confirm the package identity before production use."
  );
}

function mapSeverity(severity: PackageSecurityRawFinding["severity"]): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO" {
  switch (severity) {
    case "CRITICAL":
      return "CRITICAL";
    case "HIGH":
      return "HIGH";
    case "MEDIUM":
      return "MEDIUM";
    case "LOW":
      return "LOW";
    default:
      return "MEDIUM";
  }
}

function mapCategory(category: string): string {
  switch (category) {
    case "package-hallucination":
    case "package-typosquat":
    case "dependency-confusion":
      return "supply-chain";
    case "ecosystem-mismatch":
      return "supply-chain";
    default:
      return "supply-chain";
  }
}

export function packageSecurityRawFindingToSecurityAnalysis(
  finding: PackageSecurityRawFinding
): SecurityAnalysisFinding | null {
  const normalized = normalizeExternalFinding(
    {
      ruleId: finding.rule,
      severity: mapSeverity(finding.severity),
      category: mapCategory(finding.category),
      message: finding.message,
      file: finding.file,
      line: finding.line,
      confidence: finding.confidence,
      action: finding.action,
      matched_text: finding.match,
      metadata: {
        fix: remediationFor(finding),
        packageName: finding.packageName,
        ecosystem: finding.ecosystem,
        requestedVersion: finding.requestedVersion,
        packageSecurityTier: finding.tier,
        similarPackages: finding.similarPackages,
        registryEvidence: finding.registryEvidence,
      },
    },
    PACKAGE_SECURITY_SOURCE_TOOL
  );

  if (!normalized) return null;

  return {
    ...normalized,
    remediation: remediationFor(finding),
    metadata: {
      ...(normalized.metadata ?? {}),
      packageSecurity: {
        rule: finding.rule,
        category: finding.category,
        tier: finding.tier,
        packageName: finding.packageName,
        ecosystem: finding.ecosystem,
        requestedVersion: finding.requestedVersion,
        similarPackages: finding.similarPackages ?? [],
        registryEvidence: finding.registryEvidence ?? null,
        evidenceSource: AGENT_SECURITY_SCANNER_ID,
        scanner: AGENT_SECURITY_SCANNER_ID,
        sourceTool: PACKAGE_SECURITY_SOURCE_TOOL,
        confidence: finding.confidence,
        verificationStatus: normalized.verificationStatus,
        action: finding.action,
      },
    },
  };
}

export function packageSecurityRawFindingsToSecurityAnalysis(
  findings: PackageSecurityRawFinding[]
): SecurityAnalysisFinding[] {
  return findings
    .map(packageSecurityRawFindingToSecurityAnalysis)
    .filter((finding): finding is SecurityAnalysisFinding => finding != null);
}

export function dedupePackageSecurityAnalysisFindings(
  findings: SecurityAnalysisFinding[]
): SecurityAnalysisFinding[] {
  const seen = new Set<string>();
  const deduped: SecurityAnalysisFinding[] = [];
  for (const finding of findings) {
    const packageName =
      typeof finding.metadata?.packageSecurity === "object" &&
      finding.metadata.packageSecurity &&
      "packageName" in finding.metadata.packageSecurity
        ? String((finding.metadata.packageSecurity as { packageName?: string }).packageName ?? "")
        : "";
    const key = `${finding.externalRuleId}|${packageName}|${finding.file ?? ""}|${finding.line ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}
