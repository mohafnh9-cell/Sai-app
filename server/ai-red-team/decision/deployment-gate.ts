import type { DecisionPolicyResult } from "./decision-policy";
import type { SecurityDecisionType } from "./decision-model";
import type { RiskAcceptanceInfluence } from "./risk-acceptance";
import type { CoverageAssessment } from "./coverage-engine";

const DECISION_RANK: Record<SecurityDecisionType, number> = {
  BLOCK_DEPLOYMENT: 5,
  INSUFFICIENT_EVIDENCE: 4,
  REQUIRES_VERIFICATION: 3,
  APPROVE_WITH_WARNINGS: 2,
  APPROVE_DEPLOYMENT: 1,
};

export type DeploymentGateResult = {
  decision: SecurityDecisionType;
  policiesTriggered: string[];
  evidenceUsed: string[];
  evidenceMissing: string[];
  rationale: string[];
};

export function evaluateDeploymentGate(input: {
  policyResults: DecisionPolicyResult[];
  coverage: CoverageAssessment;
  riskAcceptance: RiskAcceptanceInfluence;
  hasFindings: boolean;
  minCoverageScore: number;
}): DeploymentGateResult {
  const triggered = input.policyResults.filter((p) => p.triggered);
  const policiesTriggered = triggered.map((p) => p.policyId);
  const evidenceUsed = [...new Set(triggered.flatMap((p) => p.evidenceUsed))];
  const evidenceMissing = [...new Set(triggered.flatMap((p) => p.evidenceMissing))];
  const rationale = triggered.map((p) => p.rationale);

  let decision: SecurityDecisionType = "APPROVE_DEPLOYMENT";

  for (const result of triggered) {
    if (!result.effect) continue;
    if (DECISION_RANK[result.effect] > DECISION_RANK[decision]) {
      decision = result.effect;
    }
  }

  if (!input.hasFindings && input.coverage.score < input.minCoverageScore) {
    decision =
      DECISION_RANK.INSUFFICIENT_EVIDENCE > DECISION_RANK[decision]
        ? "INSUFFICIENT_EVIDENCE"
        : decision;
    rationale.push("Insufficient attack-team observations for confident deploy decision.");
    evidenceMissing.push("attack_team_observations");
  }

  if (input.coverage.score < input.minCoverageScore && decision === "APPROVE_DEPLOYMENT") {
    decision = "REQUIRES_VERIFICATION";
    rationale.push("Coverage gaps require additional testing before production.");
  }

  if (input.riskAcceptance.suppressedBlockerFindingIds.length > 0 && decision === "BLOCK_DEPLOYMENT") {
    const remainingBlockers = input.policyResults
      .find((p) => p.policyId === "gate.confirmed_deploy_blocker")
      ?.evidenceUsed.filter(
        (id) => !input.riskAcceptance.suppressedBlockerFindingIds.includes(id)
      );
    if (!remainingBlockers?.length) {
      decision = "APPROVE_WITH_WARNINGS";
      rationale.push("All blockers covered by active accepted-risk records.");
    }
  }

  return { decision, policiesTriggered, evidenceUsed, evidenceMissing, rationale };
}
