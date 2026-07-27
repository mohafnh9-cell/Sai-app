import type { BusinessLogicTeamResult } from "../business-logic.types";
import type { BusinessLogicFinding } from "../findings/finding.types";
import type { BusinessLogicExecutionSummary } from "../runtime/runtime.types";
import type { BusinessLogicSpecialistExecutionSummary } from "../specialists/specialist.types";

export type BusinessLogicFindingSummary = {
  total: number;
  bySeverity: Record<string, number>;
  byConfidence: Record<string, number>;
};

export type BusinessLogicRiskSummary = {
  riskAreas: string[];
  monetaryFindings: number;
  topBusinessImpact: string | null;
};

export type BusinessLogicEvidenceSummary = {
  runtimeBackedEvidenceCount: number;
  invariantLinkedCount: number;
};

export type BusinessLogicCoverage = {
  workflowsDiscovered: number;
  stateMachinesBuilt: number;
  invariantsExtracted: number;
  abuseHypothesesGenerated: number;
  specialistsCompleted: number;
  runtimeExecutionsCompleted: number;
  findingsEmitted: number;
  coveragePercent: number;
};

export type BusinessLogicConfidence = {
  band: "very_high" | "high" | "medium" | "low" | "unknown";
  score: number;
};

export type BusinessLogicRiskAreas = {
  areas: string[];
};

export type BusinessLogicExecutionSummaryExposure = {
  profileId: string | null;
  plansCompleted: number;
  plansFailed: number;
  evaluationsUsed: number;
  runtimeMsUsed: number;
  partialReason: string | null;
};

export type BusinessLogicReplaySummary = {
  replayPlanCount: number;
  executableReplayPlans: number;
};

export type BusinessLogicObservabilityMetrics = {
  workflows: number;
  fsms: number;
  invariants: number;
  abuseCases: number;
  runtimeExecutions: number;
  replayPlans: number;
  findings: number;
  coveragePercent: number;
  executionDurationMs: number;
  specialistsCompleted: number;
  specialistsSkipped: number;
  specialistsFailed: number;
  specialistSuccessRate: number;
  executionMode: string;
  analysisPhase: string;
};

export type BusinessLogicDecisionExposure = {
  findingCount: number;
  blockingCandidateCount: number;
  evidenceSummary: string;
  requiredFixThemes: string[];
};

export type BusinessLogicUeeRemediationInput = {
  findingId: string;
  workflowId: string;
  workflowKind: string;
  invariantKeys: string[];
  transitionIds: string[];
  entityIds: string[];
  replayPlanId: string;
  protectionTarget: string;
  expectedInvariantRestoration: string | null;
};

export type BusinessLogicAsoOrchestrationHints = {
  teamId: "business_logic";
  attackDomain: "payments";
  supportedOperations: Array<
    | "business_logic_review"
    | "replay_validation"
    | "reanalysis"
    | "incremental_workflow_scan"
    | "selective_specialist_execution"
  >;
  autoExecute: false;
  incrementalWorkflowScanEligible: boolean;
  selectiveSpecialistEligible: boolean;
  replayValidationEligible: boolean;
};

export type BusinessLogicMissionControlMetrics = {
  coveragePercent: number;
  confidenceBand: BusinessLogicConfidence["band"];
  workflowCount: number;
  fsmCount: number;
  invariantCount: number;
  abuseCaseCount: number;
  specialistsExecuted: number;
  specialistsSkipped: number;
  runtimeExecutions: number;
  findingsCount: number;
  replayPlanCount: number;
  executionDurationMs: number;
  executionMode: string;
  analysisPhase: string;
};

export type BusinessLogicPlatformPayload = {
  findingSummary: BusinessLogicFindingSummary;
  riskSummary: BusinessLogicRiskSummary;
  evidenceSummary: BusinessLogicEvidenceSummary;
  coverage: BusinessLogicCoverage;
  confidence: BusinessLogicConfidence;
  riskAreas: BusinessLogicRiskAreas;
  executionSummary: BusinessLogicExecutionSummaryExposure;
  replaySummary: BusinessLogicReplaySummary;
  observability: BusinessLogicObservabilityMetrics;
  decisionExposure: BusinessLogicDecisionExposure;
  ueeRemediationInputs: BusinessLogicUeeRemediationInput[];
  asoOrchestration: BusinessLogicAsoOrchestrationHints;
  missionControl: BusinessLogicMissionControlMetrics;
};

function confidenceBand(score: number): BusinessLogicConfidence["band"] {
  if (score >= 0.9) return "very_high";
  if (score >= 0.75) return "high";
  if (score >= 0.55) return "medium";
  if (score >= 0.35) return "low";
  return "unknown";
}

function coveragePercent(input: {
  workflows: number;
  invariants: number;
  abuse: number;
  specialists: number;
  runtime: number;
  findings: number;
}): number {
  const steps = [
    input.workflows > 0 ? 1 : 0,
    input.invariants > 0 ? 1 : 0,
    input.abuse > 0 ? 1 : 0,
    input.specialists > 0 ? 1 : 0,
    input.runtime > 0 ? 1 : 0,
    input.findings >= 0 ? 1 : 0,
  ];
  return Math.round((steps.reduce((a, b) => a + b, 0) / steps.length) * 100);
}

export function buildBusinessLogicPlatformPayload(
  result: BusinessLogicTeamResult
): BusinessLogicPlatformPayload {
  const domain = result.context?.domainModel;
  const findings: BusinessLogicFinding[] = domain?.findingCollection?.findings ?? [];
  const specialistSummary: BusinessLogicSpecialistExecutionSummary | undefined =
    domain?.specialistExecution;
  const runtimeSummary: BusinessLogicExecutionSummary | undefined = domain?.runtimeExecution;

  const bySeverity: Record<string, number> = {};
  const byConfidence: Record<string, number> = {};
  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    byConfidence[f.confidence] = (byConfidence[f.confidence] ?? 0) + 1;
  }

  const avgConfidence =
    findings.length === 0
      ? 0
      : findings.reduce((n, f) => {
          const map = { confirmed: 0.95, highly_likely: 0.88, likely: 0.78, possible: 0.55, unsupported: 0.2 };
          return n + map[f.confidence];
        }, 0) / findings.length;

  const riskAreas = new Set<string>();
  for (const w of domain?.workflows ?? []) {
    for (const r of w.riskAreas) riskAreas.add(r);
  }

  const runtimeEvidence = findings.reduce(
    (n, f) => n + f.evidence.filter((e) => e.source === "runtime" || e.source === "fsm").length,
    0
  );

  const replayPlans = findings.map((f) => f.replayPlan);
  const specialistsTotal = specialistSummary?.specialistsTotal ?? 0;
  const specialistsCompleted = specialistSummary?.specialistsCompleted ?? 0;
  const specialistsFailed = specialistSummary?.specialistsFailed ?? 0;
  const specialistsSkipped = specialistSummary?.specialistsSkipped ?? 0;
  const successRate =
    specialistsTotal === 0 ? 1 : specialistsCompleted / Math.max(1, specialistsTotal - specialistsSkipped);

  const cov = coveragePercent({
    workflows: result.workflowsDiscovered,
    invariants: result.invariantsExtracted,
    abuse: result.abuseHypothesesGenerated,
    specialists: result.specialistsCompleted,
    runtime: result.runtimeExecutionsCompleted,
    findings: result.findingsCount,
  });

  const blockingCandidateCount = findings.filter(
    (f) => f.severity === "critical" || f.severity === "high"
  ).length;

  const ueeRemediationInputs: BusinessLogicUeeRemediationInput[] = findings.map((f) => ({
    findingId: f.findingId,
    workflowId: f.workflowId,
    workflowKind: f.workflowKind,
    invariantKeys: f.invariantKeys,
    transitionIds: f.transitionIds,
    entityIds: f.entityIds,
    replayPlanId: f.replayPlan.id,
    protectionTarget:
      f.mitigation.recommendations[0]?.statement ?? f.mitigation.summary,
    expectedInvariantRestoration:
      f.mitigation.recommendations.find((r) => r.kind === "restore_invariant")?.statement ?? null,
  }));

  return {
    findingSummary: { total: findings.length, bySeverity, byConfidence },
    riskSummary: {
      riskAreas: [...riskAreas],
      monetaryFindings: findings.filter((f) => f.economicImpact.includes("monetary") || f.category === "economic_inconsistency").length,
      topBusinessImpact: findings[0]?.businessImpact ?? null,
    },
    evidenceSummary: {
      runtimeBackedEvidenceCount: runtimeEvidence,
      invariantLinkedCount: findings.length,
    },
    coverage: {
      workflowsDiscovered: result.workflowsDiscovered,
      stateMachinesBuilt: domain?.stateMachines.length ?? 0,
      invariantsExtracted: result.invariantsExtracted,
      abuseHypothesesGenerated: result.abuseHypothesesGenerated,
      specialistsCompleted: result.specialistsCompleted,
      runtimeExecutionsCompleted: result.runtimeExecutionsCompleted,
      findingsEmitted: result.findingsCount,
      coveragePercent: cov,
    },
    confidence: { band: confidenceBand(avgConfidence), score: avgConfidence },
    riskAreas: { areas: [...riskAreas] },
    executionSummary: {
      profileId: runtimeSummary?.profileId ?? null,
      plansCompleted: runtimeSummary?.plansCompleted ?? 0,
      plansFailed: runtimeSummary?.plansFailed ?? 0,
      evaluationsUsed: runtimeSummary?.budgetUsage.evaluationsUsed ?? 0,
      runtimeMsUsed: runtimeSummary?.budgetUsage.runtimeMsUsed ?? 0,
      partialReason: runtimeSummary?.partialReason ?? null,
    },
    replaySummary: {
      replayPlanCount: replayPlans.length,
      executableReplayPlans: replayPlans.filter((p) => p.executable).length,
    },
    observability: {
      workflows: result.workflowsDiscovered,
      fsms: domain?.stateMachines.length ?? 0,
      invariants: result.invariantsExtracted,
      abuseCases: result.abuseHypothesesGenerated,
      runtimeExecutions: result.runtimeExecutionsCompleted,
      replayPlans: replayPlans.length,
      findings: result.findingsCount,
      coveragePercent: cov,
      executionDurationMs: result.durationMs,
      specialistsCompleted,
      specialistsSkipped,
      specialistsFailed,
      specialistSuccessRate: successRate,
      executionMode: result.executionMode,
      analysisPhase: result.analysisPhase,
    },
    decisionExposure: {
      findingCount: findings.length,
      blockingCandidateCount,
      evidenceSummary: `${runtimeEvidence} runtime-backed evidence item(s) across ${findings.length} finding(s).`,
      requiredFixThemes: [
        ...new Set(
          findings.flatMap((f) => f.mitigation.recommendations.map((r) => r.kind))
        ),
      ],
    },
    ueeRemediationInputs,
    asoOrchestration: {
      teamId: "business_logic",
      attackDomain: "payments",
      supportedOperations: [
        "business_logic_review",
        "replay_validation",
        "reanalysis",
        "incremental_workflow_scan",
        "selective_specialist_execution",
      ],
      autoExecute: false,
      incrementalWorkflowScanEligible: result.workflowsDiscovered > 1,
      selectiveSpecialistEligible: (specialistSummary?.specialistsTotal ?? 0) > 1,
      replayValidationEligible: replayPlans.some((p) => p.executable),
    },
    missionControl: {
      coveragePercent: cov,
      confidenceBand: confidenceBand(avgConfidence),
      workflowCount: result.workflowsDiscovered,
      fsmCount: domain?.stateMachines.length ?? 0,
      invariantCount: result.invariantsExtracted,
      abuseCaseCount: result.abuseHypothesesGenerated,
      specialistsExecuted: specialistsCompleted,
      specialistsSkipped,
      runtimeExecutions: result.runtimeExecutionsCompleted,
      findingsCount: result.findingsCount,
      replayPlanCount: replayPlans.length,
      executionDurationMs: result.durationMs,
      executionMode: result.executionMode,
      analysisPhase: result.analysisPhase,
    },
  };
}

export type BusinessLogicIntelligenceBundle = Pick<
  BusinessLogicPlatformPayload,
  | "findingSummary"
  | "riskSummary"
  | "evidenceSummary"
  | "coverage"
  | "confidence"
  | "riskAreas"
  | "executionSummary"
  | "replaySummary"
  | "decisionExposure"
>;
