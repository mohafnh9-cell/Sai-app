import type { LlmTeamResult } from "../llm-team.types";
import type { AIFinding } from "../findings/finding.types";
import type { AIExecutionGraph } from "../model/execution-graph.types";
import { computeStepCoverage } from "../../core/coverage/coverage.types";
import {
  summarizeAttackPreconditions,
  type AttackPreconditionsSummary,
} from "./preconditions-export";
import {
  summarizeProtectedAssets,
  type ProtectedAssetSummary,
} from "./protected-assets";

export type AIFindingSummary = {
  total: number;
  bySeverity: Record<string, number>;
  byConfidence: Record<string, number>;
};

export type AITrustSummary = {
  trustBoundaries: number;
  invariantsExtracted: number;
  violatedInvariants: number;
  topTrustImpact: string | null;
};

export type AIRiskSummary = {
  deploymentRisk: "elevated" | "moderate" | "low";
  aiTrustRisk: string;
  protectedAssetRisk: string[];
  attackSurfaceAreas: string[];
};

export type LayerCoverageSlice = {
  present: boolean;
  nodeCount: number;
  coveragePercent: number;
};

export type AICoverage = {
  graphBuilt: boolean;
  invariantsExtracted: number;
  attackCasesGenerated: number;
  specialistsCompleted: number;
  runtimeExecutionsCompleted: number;
  findingsEmitted: number;
  coveragePercent: number;
};

export type AIExecutionCoverage = {
  executionGraphNodes: number;
  executionGraphEdges: number;
  executionPaths: number;
  runtimePlansCompleted: number;
};

export type AIInvariantCoverage = {
  total: number;
  categories: Record<string, number>;
};

export type LlmLayerCoverageBundle = {
  promptCoverage: LayerCoverageSlice;
  memoryCoverage: LayerCoverageSlice;
  toolCoverage: LayerCoverageSlice;
  mcpCoverage: LayerCoverageSlice;
  agentCoverage: LayerCoverageSlice;
  ragCoverage: LayerCoverageSlice;
};

export type ExecutionStatistics = {
  executionDurationMs: number;
  runtimeBudgetMs: number;
  runtimeMsUsed: number;
  failureCount: number;
  skippedSpecialists: number;
  specialistsExecuted: number;
  replayPlanCount: number;
};

export type ReplaySummary = {
  replayPlanCount: number;
  executableReplayPlans: number;
  replayConfidence: number;
};

export type LlmObservabilityMetrics = {
  aiFindings: number;
  protectedAssets: number;
  attackPreconditions: number;
  promptCoveragePercent: number;
  toolCoveragePercent: number;
  memoryCoveragePercent: number;
  mcpCoveragePercent: number;
  agentCoveragePercent: number;
  replayCount: number;
  executionDurationMs: number;
  runtimeBudgetMs: number;
  specialistExecutions: number;
  failureCount: number;
  coveragePercent: number;
};

export type LlmDecisionExposure = {
  findingCount: number;
  deploymentRisk: AIRiskSummary["deploymentRisk"];
  aiTrustRisk: string;
  protectedAssetRisk: string[];
  attackPreconditions: string;
  replayConfidence: number;
  businessImpact: string | null;
  requiredAttackerCapability: string[];
  confidence: number;
  severity: Record<string, number>;
  remediationContext: string;
  blockingCandidateCount: number;
};

export type LlmUeeRemediationInput = {
  findingId: string;
  affectedComponents: string[];
  protectedAssets: string[];
  brokenTrustBoundaryId: string;
  violatedInvariantId: string;
  violatedInvariantKey: string;
  executionPathId: string | null;
  replayPlanId: string;
  replayPreconditions: import("../findings/finding.types").AttackPreconditions;
  promptLayer: string | null;
  memoryLayer: string | null;
  retrievalLayer: string | null;
  toolLayer: string | null;
  agentLayer: string | null;
  mcpLayer: string | null;
  expectedTrustRestoration: string | null;
  expectedValidationCriteria: string;
};

export type LlmAsoOrchestrationHints = {
  teamId: "llm";
  attackDomain: "llm";
  supportedOperations: Array<
    | "prompt_validation"
    | "replay_validation"
    | "selective_specialist_execution"
    | "incremental_ai_scan"
    | "trust_boundary_revalidation"
    | "agent_revalidation"
    | "mcp_revalidation"
    | "memory_revalidation"
  >;
  autoExecute: false;
  promptValidationEligible: boolean;
  replayValidationEligible: boolean;
  selectiveSpecialistEligible: boolean;
  incrementalAiScanEligible: boolean;
  trustBoundaryRevalidationEligible: boolean;
  agentRevalidationEligible: boolean;
  mcpRevalidationEligible: boolean;
  memoryRevalidationEligible: boolean;
};

export type LlmMissionControlMetrics = {
  aiComponents: number;
  executionGraphNodes: number;
  executionGraphEdges: number;
  trustBoundaries: number;
  trustInvariants: number;
  attackCases: number;
  executedSpecialists: number;
  runtimeExecutions: number;
  replayPlans: number;
  protectedAssets: number;
  attackPreconditions: number;
  coveragePercent: number;
  executionDurationMs: number;
  failureCount: number;
  skippedSpecialists: number;
  runtimeBudgetMs: number;
  executionMode: string;
  analysisPhase: string;
  findingsCount: number;
  confidenceBand: "very_high" | "high" | "medium" | "low" | "unknown";
};

export type LlmPlatformPayload = {
  findingSummary: AIFindingSummary;
  trustSummary: AITrustSummary;
  riskSummary: AIRiskSummary;
  coverage: AICoverage;
  executionCoverage: AIExecutionCoverage;
  invariantCoverage: AIInvariantCoverage;
  layerCoverage: LlmLayerCoverageBundle;
  protectedAssetSummary: ProtectedAssetSummary;
  attackPreconditionsSummary: AttackPreconditionsSummary;
  executionStatistics: ExecutionStatistics;
  replaySummary: ReplaySummary;
  observability: LlmObservabilityMetrics;
  decisionExposure: LlmDecisionExposure;
  ueeRemediationInputs: LlmUeeRemediationInput[];
  asoOrchestration: LlmAsoOrchestrationHints;
  missionControl: LlmMissionControlMetrics;
};

function confidenceBand(score: number): LlmMissionControlMetrics["confidenceBand"] {
  if (score >= 0.9) return "very_high";
  if (score >= 0.75) return "high";
  if (score >= 0.55) return "medium";
  if (score >= 0.35) return "low";
  return "unknown";
}

function confidenceNumeric(conf: AIFinding["confidence"]): number {
  const map = {
    confirmed: 0.95,
    highly_likely: 0.88,
    likely: 0.78,
    possible: 0.55,
    unsupported: 0.2,
  } as const;
  return map[conf];
}

function layerSlice(graph: AIExecutionGraph, kinds: AIExecutionGraph["nodes"][number]["kind"][]): LayerCoverageSlice {
  const nodeCount = graph.nodes.filter((n) => kinds.includes(n.kind)).length;
  const denom = Math.max(1, kinds.length);
  return {
    present: nodeCount > 0,
    nodeCount,
    coveragePercent: Math.round((Math.min(nodeCount, denom) / denom) * 100),
  };
}

function pipelineCoveragePercent(result: LlmTeamResult): number {
  return computeStepCoverage([
    (result.graphNodeCount ?? 0) > 0,
    (result.invariantsExtracted ?? 0) > 0,
    (result.attackCasesGenerated ?? 0) > 0,
    (result.specialistsCompleted ?? 0) > 0,
    (result.runtimeExecutionsCompleted ?? 0) > 0,
    (result.findingsCount ?? 0) >= 0,
  ]);
}

function deploymentRisk(findings: AIFinding[]): AIRiskSummary["deploymentRisk"] {
  if (findings.some((f) => f.severity === "critical")) return "elevated";
  if (findings.some((f) => f.severity === "high")) return "moderate";
  return "low";
}

export function buildLlmPlatformPayload(result: LlmTeamResult): LlmPlatformPayload {
  const graph = result.graph!;
  const findings: AIFinding[] = result.findings?.findings ?? [];
  const specialistSummary = result.specialistSummary;
  const runtimeSummary = result.runtimeSummary;

  const bySeverity: Record<string, number> = {};
  const byConfidence: Record<string, number> = {};
  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    byConfidence[f.confidence] = (byConfidence[f.confidence] ?? 0) + 1;
  }

  const avgConfidence =
    findings.length === 0
      ? 0
      : findings.reduce((n, f) => n + confidenceNumeric(f.confidence), 0) / findings.length;

  const invariantCategories: Record<string, number> = {};
  for (const inv of result.invariants?.invariants ?? []) {
    invariantCategories[inv.category] = (invariantCategories[inv.category] ?? 0) + 1;
  }

  const layerCoverage: LlmLayerCoverageBundle = {
    promptCoverage: layerSlice(graph, ["system_prompt", "developer_prompt", "user_prompt"]),
    memoryCoverage: layerSlice(graph, ["memory", "conversation"]),
    toolCoverage: layerSlice(graph, ["tool", "function_call"]),
    mcpCoverage: layerSlice(graph, ["mcp_server", "mcp_client"]),
    agentCoverage: layerSlice(graph, ["agent", "sub_agent"]),
    ragCoverage: layerSlice(graph, ["retrieved_context", "vector_store", "knowledge_base", "embedding"]),
  };

  const protectedAssetSummary = summarizeProtectedAssets({ graph, findings });
  const attackPreconditionsSummary = summarizeAttackPreconditions(findings);

  const cov = pipelineCoveragePercent(result);
  const replayPlans = findings.map((f) => f.replayPlan);
  const replayConfidence =
    replayPlans.length === 0
      ? 0
      : replayPlans.reduce((n, p) => n + (p.expectedEvidence.length > 0 ? 0.85 : 0.65), 0) /
        replayPlans.length;

  const specialistsSkipped = specialistSummary?.specialistsSkipped ?? result.specialistsSkipped;
  const specialistsCompleted = specialistSummary?.specialistsCompleted ?? result.specialistsCompleted;
  const runtimeFailures = runtimeSummary?.failedExecutions ?? result.runtimeFailures;

  const riskSummary: AIRiskSummary = {
    deploymentRisk: deploymentRisk(findings),
    aiTrustRisk:
      findings[0]?.impact.trustImpact ??
      (result.invariantsExtracted > 0 ? "Trust invariants modeled from execution graph." : "No AI trust model."),
    protectedAssetRisk: protectedAssetSummary.assets
      .filter((a) => a.findingIds.length > 0)
      .map((a) => a.asset),
    attackSurfaceAreas: [...new Set(findings.flatMap((f) => f.correlation.affectedComponentNodeIds))].slice(0, 8),
  };

  const ueeRemediationInputs: LlmUeeRemediationInput[] = findings.map((f) => ({
    findingId: f.findingId,
    affectedComponents: f.fixContext.affectedComponentNodeIds,
    protectedAssets: f.impact.affectedAssets,
    brokenTrustBoundaryId: f.fixContext.affectedTrustBoundaryId,
    violatedInvariantId: f.fixContext.invariantToRestoreId,
    violatedInvariantKey: f.fixContext.invariantToRestoreKey,
    executionPathId: f.correlation.executionPathId,
    replayPlanId: f.replayPlan.id,
    replayPreconditions: f.attackPreconditions,
    promptLayer: f.fixContext.promptLayer,
    memoryLayer: f.fixContext.memoryLayer,
    retrievalLayer: f.fixContext.retrievalLayer,
    toolLayer: f.fixContext.toolLayer,
    agentLayer: graph.nodes.some((n) => n.kind === "agent" || n.kind === "sub_agent") ? "agent" : null,
    mcpLayer: graph.nodes.some((n) => n.kind === "mcp_server" || n.kind === "mcp_client")
      ? "mcp"
      : null,
    expectedTrustRestoration:
      f.fixContext.recommendations.find((r) => r.kind === "restore_invariant")?.statement ?? null,
    expectedValidationCriteria: f.fixContext.validationRecommendation,
  }));

  const requiredCapabilities = [
    ...new Set(findings.map((f) => f.attackPreconditions.requiredAttackerCapability)),
  ];

  return {
    findingSummary: { total: findings.length, bySeverity, byConfidence },
    trustSummary: {
      trustBoundaries: graph.boundaries.length,
      invariantsExtracted: result.invariantsExtracted,
      violatedInvariants: findings.length,
      topTrustImpact: findings[0]?.impact.trustImpact ?? null,
    },
    riskSummary,
    coverage: {
      graphBuilt: result.graphNodeCount > 0,
      invariantsExtracted: result.invariantsExtracted,
      attackCasesGenerated: result.attackCasesGenerated,
      specialistsCompleted: result.specialistsCompleted,
      runtimeExecutionsCompleted: result.runtimeExecutionsCompleted,
      findingsEmitted: result.findingsCount,
      coveragePercent: cov,
    },
    executionCoverage: {
      executionGraphNodes: graph.nodes.length,
      executionGraphEdges: graph.edges.length,
      executionPaths: graph.paths.length,
      runtimePlansCompleted: runtimeSummary?.plansCompleted ?? result.runtimeExecutionsCompleted,
    },
    invariantCoverage: {
      total: result.invariantsExtracted,
      categories: invariantCategories,
    },
    layerCoverage,
    protectedAssetSummary,
    attackPreconditionsSummary,
    executionStatistics: {
      executionDurationMs: result.durationMs,
      runtimeBudgetMs: runtimeSummary?.runtimeBudgetMs ?? 0,
      runtimeMsUsed: runtimeSummary?.budgetUsage.runtimeMsUsed ?? 0,
      failureCount: runtimeFailures,
      skippedSpecialists: specialistsSkipped,
      specialistsExecuted: specialistsCompleted,
      replayPlanCount: replayPlans.length,
    },
    replaySummary: {
      replayPlanCount: replayPlans.length,
      executableReplayPlans: replayPlans.filter((p) => p.executable).length,
      replayConfidence,
    },
    observability: {
      aiFindings: findings.length,
      protectedAssets: protectedAssetSummary.totalAssets,
      attackPreconditions: attackPreconditionsSummary.count,
      promptCoveragePercent: layerCoverage.promptCoverage.coveragePercent,
      toolCoveragePercent: layerCoverage.toolCoverage.coveragePercent,
      memoryCoveragePercent: layerCoverage.memoryCoverage.coveragePercent,
      mcpCoveragePercent: layerCoverage.mcpCoverage.coveragePercent,
      agentCoveragePercent: layerCoverage.agentCoverage.coveragePercent,
      replayCount: replayPlans.length,
      executionDurationMs: result.durationMs,
      runtimeBudgetMs: runtimeSummary?.runtimeBudgetMs ?? 0,
      specialistExecutions: specialistsCompleted,
      failureCount: runtimeFailures,
      coveragePercent: cov,
    },
    decisionExposure: {
      findingCount: findings.length,
      deploymentRisk: riskSummary.deploymentRisk,
      aiTrustRisk: riskSummary.aiTrustRisk,
      protectedAssetRisk: riskSummary.protectedAssetRisk,
      attackPreconditions: `${attackPreconditionsSummary.count} canonical precondition set(s) from RT10 findings.`,
      replayConfidence,
      businessImpact: findings[0]?.impact.businessImpact ?? null,
      requiredAttackerCapability: requiredCapabilities,
      confidence: avgConfidence,
      severity: bySeverity,
      remediationContext:
        findings[0]?.fixContext.validationRecommendation ??
        "Review AI trust invariants and replay plans before deploy.",
      blockingCandidateCount: findings.filter((f) => f.severity === "critical" || f.severity === "high").length,
    },
    ueeRemediationInputs,
    asoOrchestration: {
      teamId: "llm",
      attackDomain: "llm",
      supportedOperations: [
        "prompt_validation",
        "replay_validation",
        "selective_specialist_execution",
        "incremental_ai_scan",
        "trust_boundary_revalidation",
        "agent_revalidation",
        "mcp_revalidation",
        "memory_revalidation",
      ],
      autoExecute: false,
      promptValidationEligible: layerCoverage.promptCoverage.present,
      replayValidationEligible: replayPlans.length > 0,
      selectiveSpecialistEligible: (specialistSummary?.specialistsTotal ?? 0) > 1,
      incrementalAiScanEligible: graph.nodes.length > 3,
      trustBoundaryRevalidationEligible: graph.boundaries.length > 0,
      agentRevalidationEligible: layerCoverage.agentCoverage.present,
      mcpRevalidationEligible: layerCoverage.mcpCoverage.present,
      memoryRevalidationEligible: layerCoverage.memoryCoverage.present,
    },
    missionControl: {
      aiComponents: result.inventory?.components.length ?? 0,
      executionGraphNodes: graph.nodes.length,
      executionGraphEdges: graph.edges.length,
      trustBoundaries: graph.boundaries.length,
      trustInvariants: result.invariantsExtracted,
      attackCases: result.attackCasesGenerated,
      executedSpecialists: specialistsCompleted,
      runtimeExecutions: result.runtimeExecutionsCompleted,
      replayPlans: replayPlans.length,
      protectedAssets: protectedAssetSummary.totalAssets,
      attackPreconditions: attackPreconditionsSummary.count,
      coveragePercent: cov,
      executionDurationMs: result.durationMs,
      failureCount: runtimeFailures,
      skippedSpecialists: specialistsSkipped,
      runtimeBudgetMs: runtimeSummary?.runtimeBudgetMs ?? 0,
      executionMode: result.executionMode,
      analysisPhase: result.analysisPhase,
      findingsCount: result.findingsCount,
      confidenceBand: confidenceBand(avgConfidence),
    },
  };
}

export type LlmIntelligenceBundle = Pick<
  LlmPlatformPayload,
  | "findingSummary"
  | "trustSummary"
  | "riskSummary"
  | "coverage"
  | "executionCoverage"
  | "invariantCoverage"
  | "layerCoverage"
  | "protectedAssetSummary"
  | "attackPreconditionsSummary"
  | "executionStatistics"
  | "replaySummary"
  | "decisionExposure"
>;
