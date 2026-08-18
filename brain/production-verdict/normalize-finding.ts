import type { EvidenceReport } from "@/brain/evidence-finding/schema";
import { evidenceReportFromMetadata, parseEvidenceReport, resolveEvidenceReportConfidenceLevel } from "@/brain/evidence-finding/schema";
import {
  deriveConfidenceLevel,
  isHighConfidenceLevel,
  legacyBandFromConfidenceLevel,
} from "@/brain/confidence/derive";
import type { ConfidenceLevel } from "@/brain/confidence/types";
import {
  isNonBlockingSecretFinding,
  resolveSecretClassification,
} from "./secret-classification";
import {
  isNonBlockingSecretClassification,
  severityForSecretClassification,
  type SecretEvidenceClassification,
} from "@/features/security-scanner/rules/secret-classification";

export type NormalizedFinding = {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  ruleId?: string;
  filePath?: string;
  line?: number;
  column?: number;
  recommendation?: string;
  confidence: "high" | "medium" | "low";
  confidenceLevel: ConfidenceLevel;
  confidencePercent?: number;
  falsePositivePercent?: number;
  detectionMethod?: string;
  statusLabel?: string;
  evidence?: string;
  evidenceReport?: EvidenceReport | null;
  secretClassification?: SecretEvidenceClassification;
};

const HIGH_CONFIDENCE_RULES = new Set([
  "hardcoded-secret",
  "exposed-api-key",
  "exposed-credential",
  "secrets.exposed",
  "sql-injection",
  "missing-auth",
  "missing-rls",
  "admin-endpoint-unprotected",
]);

export function normalizeFinding(input: {
  id?: string;
  title: string;
  severity?: string | null;
  category?: string | null;
  rule_id?: string | null;
  rule?: string | null;
  file_path?: string | null;
  start_line?: number | null;
  recommendation?: string | null;
  confidence?: string | number | null;
  evidence?: string | null;
  metadata?: Record<string, unknown> | null;
}): NormalizedFinding {
  const severityRaw = (input.severity ?? "medium").toLowerCase();

  const ruleId = input.rule_id ?? input.rule ?? undefined;
  const category = (input.category ?? "general").toLowerCase();
  const secretClassification = resolveSecretClassification({
    ruleId,
    filePath: input.file_path ?? null,
    evidence: input.evidence ?? null,
    metadata: input.metadata ?? null,
  });
  const embeddedReport =
    evidenceReportFromMetadata(input.metadata ?? null) ??
    parseEvidenceReport(input.metadata?.evidenceReport);

  let severity = (
    ["critical", "high", "medium", "low", "info"].includes(severityRaw)
      ? severityRaw
      : "medium"
  ) as NormalizedFinding["severity"];

  if (secretClassification && isNonBlockingSecretClassification(secretClassification)) {
    severity = severityForSecretClassification(secretClassification);
  }

  let confidenceLevel: ConfidenceLevel = "INFERRED";
  if (isNonBlockingSecretFinding({
    ruleId,
    file_path: input.file_path,
    evidence: input.evidence,
    metadata: input.metadata ?? null,
  })) {
    confidenceLevel = "SPECULATIVE";
  } else if (embeddedReport) {
    confidenceLevel = resolveEvidenceReportConfidenceLevel(embeddedReport);
  } else if (ruleId && HIGH_CONFIDENCE_RULES.has(ruleId.toLowerCase())) {
    confidenceLevel = "PROBABLE";
  } else if (severity === "critical") {
    confidenceLevel = "PROBABLE";
  } else if (severity === "info") {
    confidenceLevel = "SPECULATIVE";
  }

  if (!embeddedReport && typeof input.confidence === "number" && input.confidence >= 0.8) {
    confidenceLevel = deriveConfidenceLevel({
      numericScore: input.confidence,
      legacyBand: "high",
    });
  } else if (!embeddedReport && typeof input.confidence === "string") {
    confidenceLevel = deriveConfidenceLevel({ legacyBand: input.confidence });
  }

  const confidence = legacyBandFromConfidenceLevel(confidenceLevel);

  return {
    id: input.id ?? `${ruleId ?? "finding"}-${input.file_path ?? "unknown"}`,
    title: input.title,
    severity,
    category,
    ruleId,
    filePath: input.file_path ?? undefined,
    line: input.start_line ?? undefined,
    recommendation: input.recommendation ?? embeddedReport?.recommendedFix ?? undefined,
    confidence,
    confidenceLevel,
    confidencePercent: embeddedReport?.confidencePercent,
    falsePositivePercent: embeddedReport?.falsePositivePercent,
    detectionMethod: embeddedReport?.detectionMethod,
    statusLabel: embeddedReport?.statusLabel,
    evidence: input.evidence ?? undefined,
    evidenceReport: embeddedReport,
    secretClassification,
  };
}

export function isCriticalSignal(finding: NormalizedFinding): boolean {
  if (isNonBlockingSecretClassification(finding.secretClassification)) {
    return false;
  }
  const haystack = `${finding.title} ${finding.category} ${finding.ruleId ?? ""}`.toLowerCase();
  return (
    finding.severity === "critical" ||
    (finding.severity === "high" &&
      isHighConfidenceLevel(finding.confidenceLevel) &&
      (haystack.includes("secret") ||
        haystack.includes("credential") ||
        haystack.includes("admin") ||
        haystack.includes("rce") ||
        haystack.includes("remote code")))
  );
}
