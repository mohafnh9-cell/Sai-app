import type { AttackFinding, AttackSeverity } from "../../types";
import type { BusinessLogicFinding } from "./finding.types";

const SEVERITY_MAP: Record<BusinessLogicFinding["severity"], AttackSeverity> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
  informational: "info",
};

const CONFIDENCE_NUM: Record<BusinessLogicFinding["confidence"], number> = {
  confirmed: 0.95,
  highly_likely: 0.88,
  likely: 0.78,
  possible: 0.55,
  unsupported: 0.2,
};

export function toAttackFinding(finding: BusinessLogicFinding): AttackFinding {
  return {
    id: finding.findingId,
    title: finding.title,
    description: finding.description,
    domain: "payments",
    severity: SEVERITY_MAP[finding.severity],
    confidence: CONFIDENCE_NUM[finding.confidence],
    evidenceIds: finding.evidence.map((e) => e.id),
    metadata: {
      team: "business_logic",
      category: finding.category,
      status: finding.status,
      workflowId: finding.workflowId,
      workflowKind: finding.workflowKind,
      entityIds: finding.entityIds,
      invariantIds: finding.invariantIds,
      invariantKeys: finding.invariantKeys,
      transitionIds: finding.transitionIds,
      specialistIds: finding.specialistIds,
      businessImpact: finding.businessImpact,
      economicImpact: finding.economicImpact,
      correlationKeys: finding.correlation.keys,
      safeFixEligible: true,
      replayEligible: finding.replayPlan.executable,
      remediationDirection: finding.mitigation.summary,
      technicalExplanation: finding.executionSummary,
      provenance: ["rt9_business_logic", "runtime_validation"],
      abuseCategory: finding.metadata.abuseCategory,
      executionId: finding.metadata.executionId,
      replayPlanId: finding.replayPlan.id,
      ueeRemediation: {
        affectedWorkflowId: finding.workflowId,
        affectedWorkflowKind: finding.workflowKind,
        affectedInvariantKeys: finding.invariantKeys,
        affectedTransitionIds: finding.transitionIds,
        affectedEntityIds: finding.entityIds,
        protectionTarget: finding.mitigation.recommendations[0]?.statement ?? finding.mitigation.summary,
        expectedInvariantRestoration: finding.mitigation.recommendations.find((r) => r.kind === "restore_invariant")
          ?.statement,
        replayPlanId: finding.replayPlan.id,
        replayExecutable: finding.replayPlan.executable,
      },
    },
  };
}

export function businessLogicFindingsToAttackFindings(
  findings: BusinessLogicFinding[]
): AttackFinding[] {
  return findings.map(toAttackFinding);
}
