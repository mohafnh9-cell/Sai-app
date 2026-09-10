import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { CanonicalEvidence, CanonicalSeverity, SequrAIFinding } from "@/server/security-evidence/canonical-finding";
import { deriveExploitability } from "@/server/security-evidence/canonical-finding";

/**
 * Shape of the fields SequrAI actually reads from Trivy's real JSON output --
 * verified against a live `trivy fs --format json` run (see engine.ts header
 * comment), not the full schema. Trivy's own `Severity` is UPPERCASE
 * (CRITICAL/HIGH/MEDIUM/LOW/UNKNOWN) -- mapped, never passed through as-is.
 */
export type TrivyVulnerability = {
  VulnerabilityID: string;
  PkgName: string;
  InstalledVersion: string;
  FixedVersion?: string;
  Severity: string;
  Title?: string;
  Description?: string;
  CweIDs?: string[];
  PrimaryURL?: string;
  CVSS?: Record<string, { V3Score?: number; V2Score?: number }>;
};

export type TrivyResult = {
  Target: string;
  Type?: string;
  Vulnerabilities?: TrivyVulnerability[];
};

export type TrivyReport = {
  Results?: TrivyResult[];
};

function mapSeverity(trivySeverity: string): CanonicalSeverity {
  switch (trivySeverity.toUpperCase()) {
    case "CRITICAL":
      return "critical";
    case "HIGH":
      return "high";
    case "MEDIUM":
      return "medium";
    case "LOW":
      return "low";
    default:
      return "info";
  }
}

export function fromTrivyReport(
  report: TrivyReport,
  ctx: { scanId: string; projectId: string; organizationId: string; now?: string }
): { findings: SequrAIFinding[]; evidence: CanonicalEvidence[] } {
  const now = ctx.now ?? new Date().toISOString();
  const findings: SequrAIFinding[] = [];
  const evidence: CanonicalEvidence[] = [];

  for (const result of report.Results ?? []) {
    for (const vuln of result.Vulnerabilities ?? []) {
      const severity = mapSeverity(vuln.Severity);
      const cvss = vuln.CVSS?.nvd?.V3Score ?? vuln.CVSS?.ghsa?.V3Score ?? null;

      const evidenceItem: CanonicalEvidence = {
        id: randomUUID(),
        kind: "DEPENDENCY",
        label: `${vuln.VulnerabilityID} in ${vuln.PkgName}@${vuln.InstalledVersion}`,
        detail: JSON.stringify({
          vulnerabilityId: vuln.VulnerabilityID,
          package: vuln.PkgName,
          installedVersion: vuln.InstalledVersion,
          fixedVersion: vuln.FixedVersion ?? null,
          trivySeverity: vuln.Severity,
          cvssV3: cvss,
          target: result.Target,
        }),
        redacted: false,
        capturedAt: now,
      };
      evidence.push(evidenceItem);

      // Section 12: CVSS score != exploitability automatically. A high-CVSS
      // known vulnerability with no fixed version confirmed-present is
      // real evidence of a KNOWN, unpatched weakness -- but it is still a
      // static/inventory fact, not a demonstrated exploit against THIS
      // deployment. verificationStatus stays LIKELY (strong evidence: a
      // real CVE ID + confirmed installed version), never CONFIRMED, and
      // deriveExploitability() below independently ignores the raw CVSS
      // number -- it only ever looks at verificationStatus + evidence kind.
      const verificationStatus = "LIKELY" as const;
      const fingerprint = createHash("sha256")
        .update(`trivy:${vuln.VulnerabilityID}:${vuln.PkgName}:${vuln.InstalledVersion}`)
        .digest("hex")
        .slice(0, 32);

      findings.push({
        id: `trivy:${fingerprint}`,
        fingerprint,
        title: `${vuln.VulnerabilityID}: ${vuln.Title ?? vuln.PkgName}`,
        description: vuln.Description ?? `${vuln.PkgName}@${vuln.InstalledVersion} is affected by ${vuln.VulnerabilityID}.`,
        category: "dependency",
        severity,
        confidence: "high",
        exploitability: deriveExploitability({ verificationStatus, severity, evidence: [evidenceItem] }),
        verificationStatus,
        sources: ["external_engine"],
        evidence: [evidenceItem],
        affectedFiles: [result.Target],
        affectedEndpoints: [],
        affectedAssets: [`pkg:${vuln.PkgName}@${vuln.InstalledVersion}`],
        remediation: vuln.FixedVersion
          ? `Upgrade ${vuln.PkgName} from ${vuln.InstalledVersion} to ${vuln.FixedVersion} or later.`
          : `No fixed version is published yet for ${vuln.PkgName} ${vuln.VulnerabilityID} -- track the advisory and consider a mitigating control.`,
        references: vuln.PrimaryURL ? [vuln.PrimaryURL] : [],
        cwe: vuln.CweIDs ?? [],
        owasp: [],
        mitre: [],
        scanId: ctx.scanId,
        projectId: ctx.projectId,
        organizationId: ctx.organizationId,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return { findings, evidence };
}
