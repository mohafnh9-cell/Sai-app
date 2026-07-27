import type { SecurityDecision, SecurityDecisionExplanation } from "./decision-model";
import type { SecurityIntelligenceReport } from "../intelligence/models";
import type { CoverageAssessment } from "./coverage-engine";
import type { DeploymentGateResult } from "./deployment-gate";

export function explainSecurityDecision(input: {
  decision: SecurityDecision;
  intelligence: SecurityIntelligenceReport;
  coverage: CoverageAssessment;
  gate: DeploymentGateResult;
}): SecurityDecisionExplanation {
  const topRisk = input.intelligence.verdict.topRisks[0] ?? "No dominant risk identified.";
  const founderBody = [
    input.decision.businessReasoning,
    input.decision.primaryRecommendation,
  ].filter(Boolean);

  if (input.decision.deploymentVerdict === "DO_NOT_DEPLOY") {
    founderBody.unshift(`We recommend not deploying yet. ${topRisk}`);
  } else if (input.decision.deploymentVerdict === "SAFE_TO_DEPLOY") {
    founderBody.unshift("No material blockers were identified for this commit based on current evidence.");
  }

  return {
    founder: {
      headline: input.decision.summary,
      body: founderBody,
    },
    engineer: {
      policiesTriggered: input.decision.policiesTriggered,
      coverageSummary: `Coverage score ${input.coverage.score}; gaps: ${input.coverage.gaps.join("; ") || "none"}`,
      attackChains: input.intelligence.attackChains.map((c) => c.summary),
      rootCauses: input.intelligence.priorities.slice(0, 3).map((p) => p.rationale),
      confidence: input.decision.confidence,
      evidenceUsed: input.decision.evidenceUsed,
      evidenceMissing: input.decision.evidenceMissing,
    },
  };
}
