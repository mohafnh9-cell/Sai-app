import type { EvidenceReport } from "@/brain/evidence-finding/schema";
import { evidenceReportFromMetadata, parseEvidenceReport } from "@/brain/evidence-finding/schema";

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
  confidencePercent?: number;
  falsePositivePercent?: number;
  detectionMethod?: string;
  statusLabel?: string;
  evidence?: string;
  evidenceReport?: EvidenceReport | null;
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
  const severity = (
    ["critical", "high", "medium", "low", "info"].includes(severityRaw)
      ? severityRaw
      : "medium"
  ) as NormalizedFinding["severity"];

  const ruleId = input.rule_id ?? input.rule ?? undefined;
  const category = (input.category ?? "general").toLowerCase();
  const embeddedReport =
    evidenceReportFromMetadata(input.metadata ?? null) ??
    parseEvidenceReport(input.metadata?.evidenceReport);

  let confidence: NormalizedFinding["confidence"] = "medium";
  if (embeddedReport) {
    confidence =
      embeddedReport.confidence >= 0.8 ? "high" : embeddedReport.confidence >= 0.55 ? "medium" : "low";
  } else if (ruleId && HIGH_CONFIDENCE_RULES.has(ruleId.toLowerCase())) {
    confidence = "high";
  } else if (severity === "critical") {
    confidence = "high";
  } else if (severity === "info") {
    confidence = "low";
  }

  if (!embeddedReport && typeof input.confidence === "number" && input.confidence >= 0.8) {
    confidence = "high";
  }

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
    confidencePercent: embeddedReport?.confidencePercent,
    falsePositivePercent: embeddedReport?.falsePositivePercent,
    detectionMethod: embeddedReport?.detectionMethod,
    statusLabel: embeddedReport?.statusLabel,
    evidence: input.evidence ?? undefined,
    evidenceReport: embeddedReport,
  };
}

export function isCriticalSignal(finding: NormalizedFinding): boolean {
  const haystack = `${finding.title} ${finding.category} ${finding.ruleId ?? ""}`.toLowerCase();
  return (
    finding.severity === "critical" ||
    (finding.severity === "high" &&
      finding.confidence === "high" &&
      (haystack.includes("secret") ||
        haystack.includes("credential") ||
        haystack.includes("admin") ||
        haystack.includes("rce") ||
        haystack.includes("remote code")))
  );
}
