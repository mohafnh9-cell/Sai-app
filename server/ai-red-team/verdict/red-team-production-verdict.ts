import type { SecurityDeploymentVerdictStatus } from "../decision/decision-model";
import type { ConfidenceBand } from "../intelligence/models";

/** Product-facing snapshot produced only by the Security Decision Engine (RT5). */
export type RedTeamProductionVerdict = {
  status: SecurityDeploymentVerdictStatus;
  summary: string;
  businessExplanation: string;
  technicalExplanation: string;
  topRisks: string[];
  topFixes: string[];
  confidence: ConfidenceBand;
  primaryRecommendation: string;
  generatedAt: string;
  decisionId: string;
};

export function buildRedTeamProductionVerdict(
  decision: import("../decision/decision-model").SecurityDecisionReport
): RedTeamProductionVerdict {
  return {
    status: decision.decision.deploymentVerdict,
    summary: decision.decision.summary,
    businessExplanation: decision.decision.businessReasoning,
    technicalExplanation: decision.decision.technicalReasoning,
    topRisks: decision.explanation.engineer.rootCauses.slice(0, 3),
    topFixes: decision.decision.requiredActions.map((a) => a.label),
    confidence: decision.decision.confidence,
    primaryRecommendation: decision.decision.primaryRecommendation,
    generatedAt: decision.decision.generatedAt,
    decisionId: decision.decision.decisionId,
  };
}
