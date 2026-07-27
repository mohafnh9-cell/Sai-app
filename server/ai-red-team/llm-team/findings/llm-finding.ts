import type { AttackFinding, AttackSeverity } from "../../types";
import type { AIFinding } from "./finding.types";

const SEVERITY_MAP: Record<AIFinding["severity"], AttackSeverity> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
  informational: "info",
};

const CONFIDENCE_NUM: Record<AIFinding["confidence"], number> = {
  confirmed: 0.95,
  highly_likely: 0.88,
  likely: 0.78,
  possible: 0.55,
  unsupported: 0.2,
};

export function toAttackFinding(finding: AIFinding): AttackFinding {
  return {
    id: finding.findingId,
    title: finding.title,
    description: finding.description,
    domain: "llm",
    severity: SEVERITY_MAP[finding.severity],
    confidence: CONFIDENCE_NUM[finding.confidence],
    evidenceIds: finding.evidence.map((e) => e.id),
    metadata: {
      team: "llm",
      category: finding.category,
      status: finding.status,
      invariantIds: [finding.traceability.invariantId],
      invariantKeys: [finding.traceability.invariantKey],
      specialistIds: finding.specialistIds,
      businessImpact: finding.impact.businessImpact,
      correlationKeys: finding.correlation.keys,
      safeFixEligible: true,
      replayEligible: finding.replayPlan.executable,
      remediationDirection: finding.fixContext.validationRecommendation,
      technicalExplanation: finding.executionSummary,
      provenance: ["rt10_llm_team", "runtime_validation"],
      executionId: finding.metadata.executionId,
      replayPlanId: finding.replayPlan.id,
      attackPreconditionsId: finding.traceability.attackPreconditionsId,
      ueeRemediation: {
        affectedComponentNodeIds: finding.fixContext.affectedComponentNodeIds,
        affectedTrustBoundaryId: finding.fixContext.affectedTrustBoundaryId,
        violatedInvariantId: finding.fixContext.invariantToRestoreId,
        violatedInvariantKey: finding.fixContext.invariantToRestoreKey,
        executionPathId: finding.correlation.executionPathId,
        protectedAssets: finding.impact.affectedAssets,
        replayPlanId: finding.replayPlan.id,
        replayPreconditions: finding.attackPreconditions,
        promptLayer: finding.fixContext.promptLayer,
        memoryLayer: finding.fixContext.memoryLayer,
        retrievalLayer: finding.fixContext.retrievalLayer,
        toolLayer: finding.fixContext.toolLayer,
        expectedTrustRestoration:
          finding.fixContext.recommendations.find((r) => r.kind === "restore_invariant")?.statement ?? null,
        expectedValidationCriteria: finding.fixContext.validationRecommendation,
      },
    },
  };
}

export function llmFindingsToAttackFindings(findings: AIFinding[]): AttackFinding[] {
  return findings.map(toAttackFinding);
}
