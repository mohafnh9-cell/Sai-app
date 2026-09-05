import { AGENT_SECURITY_SCANNER_ID } from "../constants";
import { deriveInitialVerificationStatus } from "../derive-verification-status";
import { deriveConfidenceLevel } from "@/brain/confidence/derive";
import type { SecurityAnalysisFinding } from "../schema";
import { packageIdentity } from "../sbom/purl";
import {
  buildSbomSnapshot,
  findLineNumber,
  getFileContent,
} from "../sbom/lockfile-parsers";
import type { RepositoryFile, SbomComponent, SbomSnapshot } from "../sbom/types";
import { componentsToOsvPackages, queryOsvBatch, type OsvClientOptions } from "./client";
import {
  cacheKeyForPackage,
  mapOsvConfidence,
  mapOsvExternalSeverity,
} from "./map-vulnerability";
import type { OsvApiVulnerability, OsvBatchResult, OsvMappedVulnerability } from "./types";
import { guardUntrustedInput } from "@/server/mcp/security";
import { promoteOsvResults, seedOsvScanCacheFromProcess } from "../shared/dependency-process-cache";

export const OSV_SBOM_RULE_ID = "dependencies.osv-sbom";
export const OSV_SBOM_EXTERNAL_RULE_ID = "dependency-vulnerability";

export type OsvSbomAnalysisOptions = {
  includeDev?: boolean;
  osv?: OsvClientOptions;
  sbomSnapshot?: SbomSnapshot;
};

export type OsvSbomAnalysisResult = {
  snapshot: ReturnType<typeof buildSbomSnapshot>;
  findings: SecurityAnalysisFinding[];
  osvError?: string;
};

function buildEvidence(component: SbomComponent, vuln: OsvMappedVulnerability): string {
  const parts = [
    `Package: ${component.name}@${component.version}`,
    `Ecosystem: ${component.ecosystem}`,
    `Advisory: ${vuln.advisoryId}`,
    `OSV: ${vuln.osvId}`,
  ];
  if (vuln.affectedVersionRange) {
    parts.push(`Affected: ${vuln.affectedVersionRange}`);
  }
  if (vuln.fixedVersion) {
    parts.push(`Fixed in: ${vuln.fixedVersion}`);
  }
  parts.push(`Source: OSV (${vuln.sourceUrl})`);
  return parts.join("\n");
}

function buildRemediation(component: SbomComponent, vuln: OsvMappedVulnerability): string {
  if (vuln.fixedVersion) {
    return `Upgrade ${component.name} from ${component.version} to ${vuln.fixedVersion} or later. Review the advisory at ${vuln.sourceUrl} before deploying.`;
  }
  return `Review ${component.name}@${component.version} against advisory ${vuln.advisoryId}. See ${vuln.sourceUrl} for mitigation guidance.`;
}

function buildMessage(component: SbomComponent, vuln: OsvMappedVulnerability): string {
  const severityLabel = vuln.severity === "unknown" ? "unknown severity" : `${vuln.severity} severity`;
  const description = guardUntrustedInput(vuln.description || "Known vulnerability in installed dependency.", {
    source: "dependency_metadata",
    path: `${component.name}@${component.version}`,
    forceWrap: true,
  }).forPrompt;
  return `[${vuln.advisoryId}] ${component.name}@${component.version} — ${severityLabel}. ${description}`;
}

function resolveLocation(
  files: RepositoryFile[],
  component: SbomComponent
): { file: string | null; line: number | null } {
  const lockfilePath = component.lockfilePath ?? null;
  if (!lockfilePath) {
    return { file: null, line: null };
  }
  const content = getFileContent(files, lockfilePath);
  if (!content) {
    return { file: lockfilePath, line: 1 };
  }
  const needle = component.name.includes("@")
    ? `"${component.name}"`
    : `"${component.name}"`;
  return {
    file: lockfilePath,
    line: findLineNumber(content, needle),
  };
}

export function osvVulnerabilityToFinding(
  component: SbomComponent,
  vuln: OsvMappedVulnerability,
  files: RepositoryFile[]
): SecurityAnalysisFinding {
  const confidence = mapOsvConfidence(vuln);
  const severity = mapOsvExternalSeverity(vuln);
  const verificationStatus = deriveInitialVerificationStatus({
    sourceTool: "osv",
    confidence,
    action: null,
  });
  const confidenceLevel = deriveConfidenceLevel({
    legacyExternal: confidence,
    verificationStatus,
  });
  const location = resolveLocation(files, component);
  const message = buildMessage(component, vuln);

  return {
    scanner: AGENT_SECURITY_SCANNER_ID,
    sourceTool: "osv",
    ruleId: `agent-scanner.osv.${OSV_SBOM_EXTERNAL_RULE_ID}`,
    externalRuleId: OSV_SBOM_EXTERNAL_RULE_ID,
    title: `Vulnerable dependency: ${component.name} (${vuln.advisoryId})`,
    description: vuln.description || message,
    message,
    category: "supply-chain",
    severity: severity.severity,
    originalSeverity: vuln.severity,
    severityRank: severity.severityRank,
    confidence,
    confidenceLevel,
    file: location.file,
    line: location.line,
    column: null,
    evidence: buildEvidence(component, vuln),
    remediation: buildRemediation(component, vuln),
    action: null,
    riskScore: vuln.cvssScore,
    cwe: null,
    owasp: null,
    verificationStatus,
    metadata: {
      securityAnalysis: {
        scanner: AGENT_SECURITY_SCANNER_ID,
        sourceTool: "osv",
        externalRuleId: OSV_SBOM_EXTERNAL_RULE_ID,
        verificationStatus,
        confidenceLevel,
        evidenceSource: "osv.dev",
      },
      osv: {
        package: component.name,
        installedVersion: component.version,
        ecosystem: component.ecosystem,
        purl: component.purl,
        advisoryId: vuln.advisoryId,
        osvId: vuln.osvId,
        aliases: vuln.aliases,
        severity: vuln.severity,
        cvssScore: vuln.cvssScore,
        cvssMethod: vuln.cvssMethod,
        affectedVersionRange: vuln.affectedVersionRange,
        fixedVersion: vuln.fixedVersion,
        sourceUrl: vuln.sourceUrl,
        evidenceSource: "osv.dev",
        confidence,
        confidenceLevel,
        verificationStatus,
      },
      sbom: {
        lockfilePath: component.lockfilePath ?? null,
        isDirect: component.isDirect ?? false,
        isDev: component.isDev ?? false,
      },
    },
  };
}

export function osvBatchToFindings(
  components: SbomComponent[],
  batch: OsvBatchResult,
  files: RepositoryFile[]
): SecurityAnalysisFinding[] {
  const findings: SecurityAnalysisFinding[] = [];
  const seen = new Set<string>();

  for (const component of components) {
    const key = packageIdentity(component);
    const vulns = batch.get(key) ?? batch.get(component.purl);
    if (!vulns?.length) continue;

    for (const vuln of vulns) {
      const dedupeKey = `${key}|${vuln.osvId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      findings.push(osvVulnerabilityToFinding(component, vuln, files));
    }
  }

  return findings;
}

export async function analyzeOsvSbomEvidence(
  files: RepositoryFile[],
  options: OsvSbomAnalysisOptions = {}
): Promise<OsvSbomAnalysisResult> {
  const snapshot =
    options.sbomSnapshot ??
    buildSbomSnapshot(files, { includeDev: options.includeDev ?? true });
  const packages = componentsToOsvPackages(snapshot.components);

  if (packages.length === 0) {
    return { snapshot, findings: [] };
  }

  // Phase 15: seed with cross-scan hits (short TTL -- vulnerability data
  // can change at any moment as new CVEs are disclosed, so this favors
  // correctness over hit rate; see dependency-process-cache.ts). Fills gaps
  // in whatever scan-level cache Map is in play (e.g. shared.osvCache from
  // createScanSharedContext, the production path) without disturbing
  // entries already present in it.
  const osvScanCache = options.osv?.cache ?? new Map<string, OsvApiVulnerability[]>();
  const keys = packages.map((pkg) => cacheKeyForPackage(pkg));
  for (const [key, value] of seedOsvScanCacheFromProcess(keys)) {
    if (!osvScanCache.has(key)) osvScanCache.set(key, value);
  }

  try {
    const batch = await queryOsvBatch(packages, { ...options.osv, cache: osvScanCache });
    promoteOsvResults(osvScanCache);
    const findings = dedupeOsvFindings(osvBatchToFindings(snapshot.components, batch, files));
    return { snapshot, findings };
  } catch (error) {
    return {
      snapshot,
      findings: [],
      osvError: error instanceof Error ? error.message : "OSV query failed",
    };
  }
}

export function dedupeOsvFindings(findings: SecurityAnalysisFinding[]): SecurityAnalysisFinding[] {
  const seen = new Set<string>();
  const deduped: SecurityAnalysisFinding[] = [];
  for (const finding of findings) {
    const osvMeta = finding.metadata?.osv as { purl?: string; osvId?: string } | undefined;
    const key = `${osvMeta?.purl ?? finding.file ?? "unknown"}|${osvMeta?.osvId ?? finding.externalRuleId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}
