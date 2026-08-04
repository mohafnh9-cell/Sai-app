import type { VerdictStatus } from "@/brain/production-verdict/schema";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import {
  finalizeProductionVerdict,
  mapSecurityDeploymentToVerdictStatus,
} from "@/brain/production-verdict/finalize-verdict";
import type {
  SecurityDecisionReport,
  SecurityDeploymentVerdictStatus,
} from "./decision-model";
import type { IntelligenceProductionVerdict } from "../intelligence/models";

export function mapDeploymentVerdictToScanStatus(
  status: SecurityDeploymentVerdictStatus
): VerdictStatus {
  return mapSecurityDeploymentToVerdictStatus(status);
}

export function mapSecurityDeploymentToMcpRecommendation(
  status: SecurityDeploymentVerdictStatus
): "SHIP_IT" | "DO_NOT_DEPLOY" | "MORE_ANALYSIS_REQUIRED" {
  switch (status) {
    case "SAFE_TO_DEPLOY":
      return "SHIP_IT";
    case "DEPLOY_WITH_WARNINGS":
      return "SHIP_IT";
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
  return finalizeProductionVerdict({
    verdict,
    securityDecisionReport: decisionReport,
  }) as ProductionVerdictV1 & {
    securityDeploymentVerdict: SecurityDeploymentVerdictStatus;
    securityDecisionId: string;
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
