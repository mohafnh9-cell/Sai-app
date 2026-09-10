import "server-only";

import type { Finding as NativeScannerFinding } from "@/features/security-scanner/types";
import type { ConsolidatedAuditFinding, FindingVerificationStatus } from "@/server/full-product-audit/types";

/**
 * Phase 34: canonical, engine-agnostic representation of a security finding.
 *
 * This does NOT replace the native scanner's `Finding`, `EvidenceReport`, or
 * `ConsolidatedAuditFinding` types -- those remain the working shapes for the
 * scanner, evidence-finding, and Full Product Audit pipelines respectively.
 * `SequrAIFinding` is the target shape every current and future engine
 * (native rules, OpenGrep, Trivy, Nuclei, ZAP, dynamic testing, pentesting,
 * AI reasoning) can be *mapped into* for cross-engine correlation, without
 * requiring any of those pipelines to change their own internal type today.
 */

export type CanonicalSeverity = "critical" | "high" | "medium" | "low" | "info";
export type CanonicalConfidence = "high" | "medium" | "low";

/**
 * One canonical verification model for the whole product. Legacy status
 * values used by server/full-product-audit/types.ts's FindingVerificationStatus
 * map onto this set via mapLegacyVerificationStatus() below -- nothing legacy
 * is deleted, this is strictly an additive superset.
 */
export type CanonicalVerificationStatus =
  | "UNVERIFIED"
  | "POTENTIAL"
  | "LIKELY"
  | "PARTIALLY_VALIDATED"
  | "VALIDATED"
  | "CONFIRMED"
  | "FALSE_POSITIVE"
  | "NOT_APPLICABLE";

export type ExploitabilityLevel = "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/**
 * First-class, evidence-driven exploitability. Never read from
 * metadata.exploitability (an untyped, ad hoc string used in one place --
 * server/ai-red-team/intelligence/priority-engine.ts) -- always computed by
 * deriveExploitability() below from verification status + evidence + severity.
 */
export type Exploitability = {
  level: ExploitabilityLevel;
  /** 0..1, how confident this level assessment itself is. */
  confidence: number;
  evidenceIds: string[];
};

export type EvidenceKind =
  | "SOURCE_CODE"
  | "AST"
  | "TAINT_FLOW"
  | "DEPENDENCY"
  | "SBOM"
  | "CONFIGURATION"
  | "HTTP_REQUEST"
  | "HTTP_RESPONSE"
  | "DYNAMIC_TEST"
  | "PENTEST"
  | "AI_REASONING"
  | "ATTACK_CHAIN";

export type CanonicalEvidence = {
  id: string;
  kind: EvidenceKind;
  label: string;
  detail?: string | null;
  /** True if `detail` has already passed through the existing redaction layer
   * (server/observability/sanitize.ts / features/security-scanner/redaction.ts). */
  redacted?: boolean;
  capturedAt: string;
};

export type FindingSource = "native_scanner" | "dynamic_test" | "pentest" | "ai_reasoning" | "external_engine";

export type SequrAIFinding = {
  id: string;
  fingerprint: string;
  title: string;
  description: string;
  category: string;
  subcategory?: string | null;
  severity: CanonicalSeverity;
  confidence: CanonicalConfidence;
  exploitability: Exploitability;
  verificationStatus: CanonicalVerificationStatus;
  /** Every engine that produced or confirmed this finding, e.g. ["native_scanner", "dynamic_test"]. */
  sources: FindingSource[];
  evidence: CanonicalEvidence[];
  affectedFiles: string[];
  affectedEndpoints: string[];
  affectedAssets: string[];
  remediation: string | null;
  references: string[];
  cwe: string[];
  owasp: string[];
  mitre: string[];
  scanId: string;
  projectId: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
};

export function mapLegacyVerificationStatus(status: FindingVerificationStatus): CanonicalVerificationStatus {
  switch (status) {
    case "CONFIRMED":
      return "CONFIRMED";
    case "LIKELY":
      return "LIKELY";
    case "POTENTIAL":
      return "POTENTIAL";
    case "NOT_REPRODUCED":
      return "UNVERIFIED";
    case "FALSE_POSITIVE":
      return "FALSE_POSITIVE";
    case "NOT_APPLICABLE":
      return "NOT_APPLICABLE";
    case "UNVERIFIED":
      return "UNVERIFIED";
    default:
      return "UNVERIFIED";
  }
}

/**
 * Rules (Phase 34 brief, section 4):
 *  - AI suspicion != confirmed vulnerability.
 *  - Static finding != confirmed exploit.
 *  - Dynamic evidence may increase confidence.
 *  - Exploit evidence may produce CONFIRMED.
 *  - False positives are explicit, never silently dropped.
 *
 * Deterministic, evidence-driven -- never assigns HIGH/CRITICAL or CONFIRMED
 * purely from finding *count* or static suspicion alone.
 */
export function deriveExploitability(input: {
  verificationStatus: CanonicalVerificationStatus;
  severity: CanonicalSeverity;
  evidence: CanonicalEvidence[];
}): Exploitability {
  const evidenceIds = input.evidence.map((e) => e.id);
  const hasRuntimeEvidence = input.evidence.some(
    (e) => e.kind === "DYNAMIC_TEST" || e.kind === "PENTEST" || e.kind === "HTTP_RESPONSE"
  );
  const severeEnough = input.severity === "critical" || input.severity === "high";

  if (input.verificationStatus === "FALSE_POSITIVE" || input.verificationStatus === "NOT_APPLICABLE") {
    return { level: "UNKNOWN", confidence: 0, evidenceIds };
  }

  if (input.verificationStatus === "CONFIRMED" && hasRuntimeEvidence) {
    return { level: input.severity === "critical" ? "CRITICAL" : "HIGH", confidence: 0.95, evidenceIds };
  }

  if (
    (input.verificationStatus === "VALIDATED" || input.verificationStatus === "LIKELY") &&
    evidenceIds.length > 0
  ) {
    return { level: severeEnough ? "HIGH" : "MEDIUM", confidence: 0.7, evidenceIds };
  }

  if (input.verificationStatus === "PARTIALLY_VALIDATED" && evidenceIds.length > 0) {
    return { level: "MEDIUM", confidence: 0.55, evidenceIds };
  }

  if (input.verificationStatus === "POTENTIAL") {
    return { level: "LOW", confidence: 0.4, evidenceIds };
  }

  return { level: "UNKNOWN", confidence: 0.2, evidenceIds };
}

function buildEvidenceFromConsolidated(finding: ConsolidatedAuditFinding, capturedAt: string): CanonicalEvidence[] {
  return finding.evidence.map((detail, index) => ({
    id: `${finding.id}:evidence:${index}`,
    kind: detail.toLowerCase().startsWith("dynamic")
      ? ("DYNAMIC_TEST" as const)
      : detail.toLowerCase().startsWith("static")
        ? ("SOURCE_CODE" as const)
        : ("AI_REASONING" as const),
    label: detail.slice(0, 120),
    detail,
    redacted: false,
    capturedAt,
  }));
}

/** Maps a Full Product Audit ConsolidatedAuditFinding into the canonical shape. */
export function fromConsolidatedAuditFinding(
  finding: ConsolidatedAuditFinding,
  ctx: { scanId: string; projectId: string; organizationId: string; now?: string }
): SequrAIFinding {
  const now = ctx.now ?? new Date().toISOString();
  const verificationStatus = mapLegacyVerificationStatus(finding.verificationStatus);
  const evidence = buildEvidenceFromConsolidated(finding, now);
  const severity = finding.severity.toLowerCase() as CanonicalSeverity;

  const sources: FindingSource[] = [];
  if (finding.source === "code_review" || finding.source === "both") sources.push("native_scanner");
  if (finding.source === "security_test" || finding.source === "both") sources.push("dynamic_test");
  if (sources.length === 0) sources.push("native_scanner");

  return {
    id: finding.id,
    fingerprint: finding.staticFindingId ?? finding.attackFindingId ?? finding.id,
    title: finding.title,
    description: finding.description,
    category: finding.category,
    severity,
    confidence: finding.confidence,
    exploitability: deriveExploitability({ verificationStatus, severity, evidence }),
    verificationStatus,
    sources,
    evidence,
    affectedFiles: finding.affectedComponent ? [finding.affectedComponent] : [],
    affectedEndpoints: [],
    affectedAssets: [],
    remediation: finding.recommendation,
    references: [],
    cwe: [],
    owasp: [],
    mitre: [],
    scanId: ctx.scanId,
    projectId: ctx.projectId,
    organizationId: ctx.organizationId,
    createdAt: now,
    updatedAt: now,
  };
}

/** Maps a raw native-scanner Finding (features/security-scanner/types.ts) into the canonical shape. */
export function fromNativeFinding(
  finding: NativeScannerFinding,
  ctx: { scanId: string; projectId: string; organizationId: string; now?: string }
): SequrAIFinding {
  const now = ctx.now ?? new Date().toISOString();
  const evidence: CanonicalEvidence[] = finding.evidence
    ? [
        {
          id: `${finding.id}:evidence:0`,
          kind: "SOURCE_CODE",
          label: finding.evidence.slice(0, 120),
          detail: finding.evidence,
          redacted: false,
          capturedAt: now,
        },
      ]
    : [];
  const verificationStatus: CanonicalVerificationStatus = "POTENTIAL";

  return {
    id: finding.id,
    fingerprint: finding.fingerprint,
    title: finding.title,
    description: finding.description,
    category: finding.category,
    severity: finding.severity,
    confidence: finding.confidence,
    exploitability: deriveExploitability({ verificationStatus, severity: finding.severity, evidence }),
    verificationStatus,
    sources: ["native_scanner"],
    evidence,
    affectedFiles: [finding.location.path],
    affectedEndpoints: [],
    affectedAssets: [],
    remediation: finding.remediation,
    references: [],
    cwe: [],
    owasp: [],
    mitre: [],
    scanId: ctx.scanId,
    projectId: ctx.projectId,
    organizationId: ctx.organizationId,
    createdAt: now,
    updatedAt: now,
  };
}
