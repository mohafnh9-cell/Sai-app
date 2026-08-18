import { z } from "zod";
import { CONFIDENCE_LEVELS, type ConfidenceLevel } from "@/brain/confidence/types";
import { deriveConfidenceLevel } from "@/brain/confidence/derive";

export const DETECTION_METHODS = [
  "STATIC_ANALYSIS",
  "DYNAMIC_ANALYSIS",
  "REPLAY",
  "MOCK_SIMULATION",
  "AUTHORIZED_STAGING",
  "LIVE_VERIFICATION",
  "HYBRID",
] as const;

export type DetectionMethod = (typeof DETECTION_METHODS)[number];

export const FINDING_CONFIRMATION_STATUSES = [
  "confirmed",
  "potential_vulnerability",
  "not_exploitable",
  "inconclusive",
  "suppressed",
] as const;

export type FindingConfirmationStatus = (typeof FINDING_CONFIRMATION_STATUSES)[number];

export const evidenceItemSchema = z.object({
  id: z.string(),
  kind: z.string(),
  label: z.string(),
  detail: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

export const ruleInfoSchema = z.object({
  ruleId: z.string(),
  ruleName: z.string(),
  ruleDescription: z.string().optional(),
  category: z.string(),
  owasp: z.array(z.string()).optional(),
  cwe: z.array(z.string()).optional(),
  mitreAttack: z.array(z.string()).optional(),
});

export type RuleInfo = z.infer<typeof ruleInfoSchema>;

export const fileLocationSchema = z.object({
  path: z.string(),
  line: z.number().int().min(1).optional(),
  column: z.number().int().min(1).optional(),
  matchedRule: z.string().optional(),
});

export type FileLocation = z.infer<typeof fileLocationSchema>;

export const evidenceReportSchema = z.object({
  version: z.literal(1),
  detectionMethod: z.enum(DETECTION_METHODS),
  confidence: z.number().min(0).max(1),
  confidenceLevel: z.enum(CONFIDENCE_LEVELS).optional(),
  confidencePercent: z.number().int().min(0).max(100),
  confidenceExplanation: z.string(),
  falsePositiveProbability: z.number().min(0).max(1),
  falsePositivePercent: z.number().int().min(0).max(100),
  falsePositiveExplanation: z.string(),
  confirmationStatus: z.enum(FINDING_CONFIRMATION_STATUSES),
  statusLabel: z.string(),
  evidence: z.array(evidenceItemSchema),
  counterEvidence: z.array(evidenceItemSchema),
  reasoning: z.string(),
  affectedFiles: z.array(fileLocationSchema),
  matchedRules: z.array(ruleInfoSchema),
  runtimeEvidence: z.array(evidenceItemSchema).optional(),
  replayEvidence: z.array(evidenceItemSchema).optional(),
  verificationStatus: z.string().optional(),
  recommendedFix: z.string().optional(),
  safeFixConfidence: z.number().min(0).max(1).optional(),
  projectType: z.string().optional(),
});

export type EvidenceReport = z.infer<typeof evidenceReportSchema>;

export const EVIDENCE_REPORT_METADATA_KEY = "evidenceReport";

export function resolveEvidenceReportConfidenceLevel(
  report: Pick<
    EvidenceReport,
    "confidence" | "confidenceLevel" | "detectionMethod" | "confirmationStatus"
  > & {
    runtimeEvidence?: EvidenceItem[];
    replayEvidence?: EvidenceItem[];
  }
): ConfidenceLevel {
  if (report.confidenceLevel) return report.confidenceLevel;
  return deriveConfidenceLevel({
    numericScore: report.confidence,
    detectionMethod: report.detectionMethod,
    hasRuntimeEvidence: Boolean(report.runtimeEvidence?.length),
    hasReplayEvidence: Boolean(report.replayEvidence?.length),
    suppressed: report.confirmationStatus === "suppressed",
    verificationStatus:
      report.confirmationStatus === "confirmed"
        ? "CONFIRMED"
        : report.confirmationStatus === "suppressed"
          ? "UNVERIFIED"
          : "POTENTIAL",
  });
}

export function withEvidenceReportConfidenceLevel(report: EvidenceReport): EvidenceReport {
  return {
    ...report,
    confidenceLevel: resolveEvidenceReportConfidenceLevel(report),
  };
}

export function parseEvidenceReport(value: unknown): EvidenceReport | null {
  const parsed = evidenceReportSchema.safeParse(value);
  return parsed.success ? withEvidenceReportConfidenceLevel(parsed.data) : null;
}

export function evidenceReportFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): EvidenceReport | null {
  if (!metadata) return null;
  return parseEvidenceReport(metadata[EVIDENCE_REPORT_METADATA_KEY]);
}
