import type { Finding } from "@/features/security-scanner/types";
import type { EvidenceReport } from "@/brain/evidence-finding/schema";
import { notEnoughEvidenceReason } from "@/brain/prompts/analysis-engine-v2";
import { CONFIDENCE_FINDING_THRESHOLD, type FindingClassification, type RepositoryModel } from "./schema";

export type FindingGateResult =
  | { allowed: true; classification: FindingClassification; evidenceReport?: EvidenceReport }
  | { allowed: false; reason: string };

const AUTH_RULE_IDS = new Set([
  "auth.missing",
  "authz.insufficient",
  "auth.missing-route-guard",
]);

const ROUTE_HEURISTIC_RULE_IDS = new Set([
  "auth.missing",
  "authz.insufficient",
  "validation.missing",
  "rate-limit.missing",
]);

export function validateFindingAgainstRepository(
  finding: Pick<
    Finding,
    | "ruleId"
    | "title"
    | "category"
    | "location"
    | "evidence"
    | "confidence"
    | "severity"
    | "description"
  >,
  model: RepositoryModel,
  evidenceReport?: EvidenceReport | null
): FindingGateResult {
  const ruleId = finding.ruleId.toLowerCase();

  if (ROUTE_HEURISTIC_RULE_IDS.has(ruleId)) {
    if (!model.capabilities.hasApiSurface) {
      return {
        allowed: false,
        reason: notEnoughEvidenceReason(
          "No API or route handlers exist in this repository — authentication finding not applicable."
        ),
      };
    }
    if (model.capabilities.hasPublicPagesOnly && !model.capabilities.hasProtectedRoutes) {
      return {
        allowed: false,
        reason: notEnoughEvidenceReason(
          "Project appears to be a public/static site without protected routes."
        ),
      };
    }
  }

  if (AUTH_RULE_IDS.has(ruleId)) {
    const requiresAuthInfrastructure =
      model.capabilities.hasProtectedRoutes ||
      model.capabilities.hasAuthLibrary ||
      model.capabilities.hasMiddleware;
    if (!requiresAuthInfrastructure && !model.capabilities.hasApiSurface) {
      return {
        allowed: false,
        reason: notEnoughEvidenceReason(
          "No authentication architecture or protected endpoints detected — cannot assert missing auth."
        ),
      };
    }
    if (model.capabilities.hasPublicPagesOnly && finding.confidence === "low") {
      return {
        allowed: false,
        reason: notEnoughEvidenceReason(
          "Low-confidence auth heuristic suppressed for public website."
        ),
      };
    }
  }

  if (ruleId.includes("middleware") && !model.capabilities.hasMiddleware && !model.capabilities.hasNextJs) {
    return {
      allowed: false,
      reason: notEnoughEvidenceReason("Project has no middleware layer."),
    };
  }

  const confidence = evidenceReport?.confidence ?? confidenceFromLabel(finding.confidence);
  const hasRequiredEvidence = Boolean(
    finding.location?.path &&
      finding.location.line &&
      (finding.evidence ||
        finding.description ||
        (evidenceReport?.evidence.length ?? 0) > 0 ||
        evidenceReport?.reasoning)
  );

  if (!hasRequiredEvidence) {
    return {
      allowed: false,
      reason: notEnoughEvidenceReason("File, line, and proof are required."),
    };
  }

  const classification: FindingClassification =
    confidence >= CONFIDENCE_FINDING_THRESHOLD
      ? finding.severity === "critical" || finding.severity === "high"
        ? "production_blocker"
        : "confirmed_finding"
      : "potential_observation";

  if (evidenceReport && evidenceReport.confidence < CONFIDENCE_FINDING_THRESHOLD) {
    return {
      allowed: true,
      classification: "potential_observation",
      evidenceReport: {
        ...evidenceReport,
        statusLabel: "Potential observation — insufficient evidence",
        confirmationStatus: "potential_vulnerability",
      },
    };
  }

  return { allowed: true, classification, evidenceReport: evidenceReport ?? undefined };
}

function confidenceFromLabel(confidence: Finding["confidence"]): number {
  if (confidence === "high") return 0.85;
  if (confidence === "medium") return 0.65;
  if (confidence === "low") return 0.4;
  return 0.55;
}

export function gateScanFindings(
  findings: Finding[],
  model: RepositoryModel
): { accepted: Finding[]; discarded: Array<{ finding: Finding; reason: string }> } {
  const accepted: Finding[] = [];
  const discarded: Array<{ finding: Finding; reason: string }> = [];

  for (const finding of findings) {
    const report = finding.metadata?.evidenceReport as EvidenceReport | undefined;
    const result = validateFindingAgainstRepository(finding, model, report ?? null);
    if (!result.allowed) {
      discarded.push({ finding, reason: result.reason });
      continue;
    }

    const metadata = {
      ...(finding.metadata ?? {}),
      findingClassification: result.classification,
      ...(result.evidenceReport ? { evidenceReport: result.evidenceReport } : {}),
    };

    if (result.classification === "potential_observation") {
      accepted.push({
        ...finding,
        title: finding.title.startsWith("Potential:")
          ? finding.title
          : `Potential: ${finding.title}`,
        severity: finding.severity === "critical" ? "high" : finding.severity,
        metadata,
      });
    } else {
      accepted.push({ ...finding, metadata });
    }
  }

  return { accepted, discarded };
}
