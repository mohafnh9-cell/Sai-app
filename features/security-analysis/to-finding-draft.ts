import type { FindingDraft, Confidence, Severity } from "@/features/security-scanner/types";
import type { FindingConfirmationStatus } from "@/brain/evidence-finding/schema";
import type { FindingVerificationStatus } from "@/server/full-product-audit/types";
import type { SecurityAnalysisFinding } from "./schema";

const SEVERITY_TO_SEQURAI: Record<SecurityAnalysisFinding["severity"], Severity> = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  INFO: "info",
};

const CONFIDENCE_TO_SEQURAI: Record<SecurityAnalysisFinding["confidence"], Confidence> = {
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
};

function mapVerificationToConfirmationStatus(
  status: FindingVerificationStatus
): FindingConfirmationStatus {
  switch (status) {
    case "CONFIRMED":
      return "confirmed";
    case "LIKELY":
    case "POTENTIAL":
      return "potential_vulnerability";
    case "FALSE_POSITIVE":
    case "NOT_APPLICABLE":
      return "not_exploitable";
    case "NOT_REPRODUCED":
    case "UNVERIFIED":
    default:
      return "inconclusive";
  }
}

function verificationStatusLabel(status: FindingVerificationStatus): string {
  switch (status) {
    case "CONFIRMED":
      return "Confirmed — verified in this repository";
    case "LIKELY":
      return "Likely — strong signal, pending repository verification";
    case "POTENTIAL":
      return "Potential — static signal, not yet verified";
    case "UNVERIFIED":
      return "Unverified heuristic — do not treat as confirmed vulnerability";
    case "NOT_REPRODUCED":
      return "Not reproduced";
    case "FALSE_POSITIVE":
      return "False positive";
    case "NOT_APPLICABLE":
      return "Not applicable";
    default:
      return "Pending verification";
  }
}

function confidenceForTrustModel(finding: SecurityAnalysisFinding): Confidence {
  if (finding.sourceTool === "scan_agent_prompt" || finding.sourceTool === "scan_skill") {
    return finding.confidence === "HIGH" ? "medium" : "low";
  }
  if (finding.sourceTool === "scan_agent_action") {
    return finding.action === "BLOCK" ? "medium" : "low";
  }
  if (finding.verificationStatus === "UNVERIFIED") {
    return "low";
  }
  return CONFIDENCE_TO_SEQURAI[finding.confidence];
}

function defaultRemediation(finding: SecurityAnalysisFinding): string {
  if (finding.remediation?.trim()) {
    return finding.remediation.trim();
  }
  if (finding.action === "BLOCK") {
    return "Review and block this agent action in production workflows until the risk is understood and mitigated.";
  }
  return "Review this finding in context and apply a safe fix before shipping to production.";
}

/**
 * Convert a normalized security-analysis finding into SequrAI's scanner FindingDraft.
 * Downstream pipeline: finalizeFinding → postProcessScanFindings → scan_findings → Production Verdict.
 */
export function securityAnalysisFindingToDraft(finding: SecurityAnalysisFinding): FindingDraft {
  const confidence = confidenceForTrustModel(finding);
  const confirmationStatus = mapVerificationToConfirmationStatus(finding.verificationStatus);
  const path = finding.file ?? "repository";
  const line = finding.line ?? 1;

  return {
    ruleId: finding.ruleId,
    title: finding.title,
    description: finding.description,
    severity: SEVERITY_TO_SEQURAI[finding.severity],
    confidence,
    category: finding.category ?? "general",
    location: {
      path,
      line,
      ...(finding.column ? { column: finding.column } : {}),
    },
    evidence: finding.evidence,
    remediation: defaultRemediation(finding),
    fingerprintMaterial: `${finding.externalRuleId}:${finding.message}:${finding.file ?? ""}:${finding.line ?? ""}`,
    metadata: {
      ...(finding.metadata ?? {}),
      ...(finding.metadata?.diffContext
        ? { diffContext: finding.metadata.diffContext }
        : {}),
      securityAnalysis: {
        ...(finding.metadata?.securityAnalysis as Record<string, unknown> | undefined),
        verificationStatus: finding.verificationStatus,
        sourceTool: finding.sourceTool,
        scanner: finding.scanner,
        externalRuleId: finding.externalRuleId,
        action: finding.action,
        cwe: finding.cwe,
        owasp: finding.owasp,
        riskScore: finding.riskScore,
      },
      evidenceReport: {
        version: 1 as const,
        detectionMethod: "STATIC_ANALYSIS" as const,
        confidence: confidence === "high" ? 0.85 : confidence === "medium" ? 0.6 : 0.35,
        confidencePercent: confidence === "high" ? 85 : confidence === "medium" ? 60 : 35,
        confidenceExplanation:
          finding.verificationStatus === "UNVERIFIED"
            ? "Heuristic scanner signal — requires repository verification before affecting Production Verdict as confirmed."
            : "External security engine signal — SequrAI will verify before treating as production-blocking.",
        falsePositiveProbability:
          finding.verificationStatus === "UNVERIFIED" ? 0.55 : 0.25,
        falsePositivePercent:
          finding.verificationStatus === "UNVERIFIED" ? 55 : 25,
        falsePositiveExplanation:
          "External scanner findings can be noisy until correlated with repository context and verification.",
        confirmationStatus,
        statusLabel: verificationStatusLabel(finding.verificationStatus),
        evidence: finding.evidence
          ? [
              {
                id: "external-scanner-evidence",
                kind: "scanner_match",
                label: "External scanner evidence",
                detail: finding.evidence,
              },
            ]
          : [],
        counterEvidence: [],
        reasoning: finding.description,
        affectedFiles: [{ path, line, matchedRule: finding.ruleId }],
        matchedRules: [
          {
            ruleId: finding.ruleId,
            ruleName: finding.title,
            category: finding.category ?? "general",
            ...(finding.cwe
              ? { cwe: Array.isArray(finding.cwe) ? finding.cwe : [finding.cwe] }
              : {}),
            ...(finding.owasp
              ? { owasp: Array.isArray(finding.owasp) ? finding.owasp : [finding.owasp] }
              : {}),
          },
        ],
        verificationStatus: finding.verificationStatus,
        recommendedFix: defaultRemediation(finding),
      },
    },
  };
}

export function securityAnalysisFindingsToDrafts(
  findings: SecurityAnalysisFinding[]
): FindingDraft[] {
  return findings.map(securityAnalysisFindingToDraft);
}
