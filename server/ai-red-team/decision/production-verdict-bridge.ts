import type { VerdictStatus } from "@/brain/production-verdict/schema";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import type {
  SecurityDecisionReport,
  SecurityDeploymentVerdictStatus,
} from "./decision-model";
import type { IntelligenceProductionVerdict } from "../intelligence/models";

export function mapDeploymentVerdictToScanStatus(
  status: SecurityDeploymentVerdictStatus
): VerdictStatus {
  switch (status) {
    case "SAFE_TO_DEPLOY":
      return "ready_to_ship";
    case "DEPLOY_WITH_WARNINGS":
      return "almost_ready";
    case "DO_NOT_DEPLOY":
      return "not_ready";
    case "INSUFFICIENT_EVIDENCE":
      return "insufficient_data";
  }
}

export function mapSecurityDeploymentToMcpRecommendation(
  status: SecurityDeploymentVerdictStatus
): "SHIP_IT" | "DO_NOT_DEPLOY" | "MORE_ANALYSIS_REQUIRED" {
  switch (status) {
    case "SAFE_TO_DEPLOY":
      return "SHIP_IT";
    case "DEPLOY_WITH_WARNINGS":
      return "DO_NOT_DEPLOY";
    case "DO_NOT_DEPLOY":
      return "DO_NOT_DEPLOY";
    case "INSUFFICIENT_EVIDENCE":
      return "MORE_ANALYSIS_REQUIRED";
  }
}

export function applySecurityDecisionToProductionVerdict(
  verdict: ProductionVerdictV1,
  decisionReport: SecurityDecisionReport
): ProductionVerdictV1 & {
  securityDeploymentVerdict: SecurityDeploymentVerdictStatus;
  securityDecisionId: string;
} {
  const status = mapDeploymentVerdictToScanStatus(decisionReport.decision.deploymentVerdict);
  return {
    ...verdict,
    status,
    executiveSummary: decisionReport.explanation.founder.headline,
    recommendedAction: decisionReport.decision.primaryRecommendation,
    confidence:
      decisionReport.decision.confidence === "very_high" || decisionReport.decision.confidence === "high"
        ? "high"
        : decisionReport.decision.confidence === "medium"
          ? "medium"
          : "low",
    securityDeploymentVerdict: decisionReport.decision.deploymentVerdict,
    securityDecisionId: decisionReport.decision.decisionId,
  };
}

/** Sync intelligence-facing verdict fields from authoritative decision output. */
export function intelligenceVerdictFromDecision(
  decisionReport: SecurityDecisionReport,
  prior: IntelligenceProductionVerdict
): IntelligenceProductionVerdict {
  const map: Record<
    SecurityDeploymentVerdictStatus,
    IntelligenceProductionVerdict["status"]
  > = {
    SAFE_TO_DEPLOY: "SAFE_TO_DEPLOY",
    DEPLOY_WITH_WARNINGS: "DEPLOY_WITH_MINOR_IMPROVEMENTS",
    DO_NOT_DEPLOY: "DO_NOT_DEPLOY",
    INSUFFICIENT_EVIDENCE: "UNKNOWN",
  };
  const status = map[decisionReport.decision.deploymentVerdict];
  return {
    ...prior,
    status,
    summary: decisionReport.decision.summary,
    businessExplanation: decisionReport.decision.businessReasoning,
    technicalExplanation: decisionReport.decision.technicalReasoning,
    topFixes: decisionReport.decision.requiredActions.map((a) => a.label),
    confidence: decisionReport.decision.confidence,
    generatedAt: decisionReport.decision.generatedAt,
  };
}

export function securityDeploymentVerdictLabel(status: SecurityDeploymentVerdictStatus): string {
  switch (status) {
    case "SAFE_TO_DEPLOY":
      return "Safe to deploy";
    case "DEPLOY_WITH_WARNINGS":
      return "Deploy with warnings";
    case "DO_NOT_DEPLOY":
      return "Do not deploy";
    case "INSUFFICIENT_EVIDENCE":
      return "Insufficient evidence";
  }
}
