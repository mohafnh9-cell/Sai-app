import { applyNarrativeGuard, narrativeMayApprove } from "./narrative-guard";
import { ProductionVerdictSchema, type ProductionVerdictV1, type VerdictStatus } from "./schema";

const STATUS_SEVERITY: Record<VerdictStatus, number> = {
  ready_to_ship: 0,
  almost_ready: 1,
  needs_improvement: 2,
  not_ready: 3,
  insufficient_data: 4,
  analysis_failed: 5,
};

const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 } as const;

function weakerConfidence(
  a: "high" | "medium" | "low",
  b: "high" | "medium" | "low"
): "high" | "medium" | "low" {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}

export type SecurityDecisionFinalizeInput = {
  decision: {
    deploymentVerdict:
      | "SAFE_TO_DEPLOY"
      | "DEPLOY_WITH_WARNINGS"
      | "DO_NOT_DEPLOY"
      | "INSUFFICIENT_EVIDENCE";
    primaryRecommendation: string;
    confidence: "very_high" | "high" | "medium" | "low" | "unknown";
    decisionId: string;
  };
  explanation: {
    founder: { headline: string };
  };
};

function worstStatus(current: VerdictStatus, candidate: VerdictStatus): VerdictStatus {
  return STATUS_SEVERITY[candidate] > STATUS_SEVERITY[current] ? candidate : current;
}

export function mapSecurityDeploymentToVerdictStatus(
  status: SecurityDecisionFinalizeInput["decision"]["deploymentVerdict"]
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

function mapDecisionConfidence(
  confidence: SecurityDecisionFinalizeInput["decision"]["confidence"]
): "high" | "medium" | "low" {
  if (confidence === "very_high" || confidence === "high") return "high";
  if (confidence === "medium") return "medium";
  return "low";
}

/**
 * The security-decision report's primary recommendation is free-form (it can
 * be "Continue to production with monitoring."). It may only replace the
 * evidence-derived, status-based recommended action where it cannot read as
 * an approval: never for insufficient_data / analysis_failed, and for
 * ready_to_ship only when the evidence supports approval.
 */
function decisionRecommendationMayReplace(status: VerdictStatus, verdict: ProductionVerdictV1): boolean {
  if (status === "insufficient_data" || status === "analysis_failed") return false;
  if (status === "ready_to_ship") return narrativeMayApprove({ ...verdict, status });
  return true;
}

export function finalizeProductionVerdict(input: {
  verdict: ProductionVerdictV1;
  securityDecisionReport?: SecurityDecisionFinalizeInput | null;
  attackSimulation?: ProductionVerdictV1["attackSimulation"] | null;
}): ProductionVerdictV1 {
  let verdict = input.verdict;
  let status = verdict.status;

  if (input.attackSimulation?.stillVulnerableExecutions) {
    status = worstStatus(status, "not_ready");
  }

  if (input.securityDecisionReport) {
    const decisionStatus = mapSecurityDeploymentToVerdictStatus(
      input.securityDecisionReport.decision.deploymentVerdict
    );
    status = worstStatus(status, decisionStatus);

    if (verdict.blockersCount > 0 && status === "ready_to_ship") {
      status = "not_ready";
    }

    verdict = {
      ...verdict,
      status,
      executiveSummary: input.securityDecisionReport.explanation.founder.headline,
      recommendedAction: decisionRecommendationMayReplace(status, verdict)
        ? input.securityDecisionReport.decision.primaryRecommendation
        : verdict.recommendedAction,
      // AI/security-decision output may only weaken the evidence-derived
      // confidence, never raise it.
      confidence: weakerConfidence(
        verdict.confidence,
        mapDecisionConfidence(input.securityDecisionReport.decision.confidence)
      ),
      securityDeploymentVerdict: input.securityDecisionReport.decision.deploymentVerdict,
      securityDecisionId: input.securityDecisionReport.decision.decisionId,
    };
  } else {
    verdict = { ...verdict, status };
  }

  if (input.attackSimulation) {
    verdict = {
      ...verdict,
      attackSimulation: input.attackSimulation,
    };
  }

  return applyNarrativeGuard(ProductionVerdictSchema.parse(verdict));
}
