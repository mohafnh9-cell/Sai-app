import type { DiscoveryReport } from "../../discovery/types";
import type { AiDiscoveryInventory } from "../discovery/discovery.types";
import type { AIExecutionGraph } from "../model/execution-graph.types";
import type { AIInvariantCollection } from "../invariants/invariant.types";
import type { AIAttackCollection } from "../attacks/attack.types";
import type { AIInvariantCategory } from "../invariants/invariant.types";
import type { AIAttackCategory } from "../attacks/attack.types";
import type { DiscoveredAiComponentKind } from "../discovery/discovery.types";
import type { NormalizedAiProviderFamily } from "../model/normalize-provider";

export type AISpecialistStatus =
  | "completed"
  | "partial"
  | "skipped"
  | "failed"
  | "timeout"
  | "unsupported"
  | "blocked";

export type AISpecialistObservationStatus =
  | "hypothesis_aligned"
  | "evidence_supported"
  | "assumption_gap"
  | "needs_runtime"
  | "informational";

export type AISpecialistExecutionClassification =
  | "static_plan_only"
  | "future_mock_runtime"
  | "future_live_runtime";

export type AISpecialistCapability = {
  id: string;
  label: string;
  description: string;
};

export type AISpecialistArchitecture =
  | "chat"
  | "rag"
  | "tools"
  | "mcp"
  | "agents"
  | "streaming"
  | "memory_persistence";

export type AISpecialistEligibility = {
  eligible: boolean;
  reason: string;
  matchedComponentKinds: DiscoveredAiComponentKind[];
  matchedNodeKinds: string[];
  matchedBoundaryKinds: string[];
  matchedArchitectures: AISpecialistArchitecture[];
  matchedProviderFamilies: NormalizedAiProviderFamily[];
  matchedInvariantCategories: AIInvariantCategory[];
  matchedAttackCategories: AIAttackCategory[];
};

export type AISpecialistValidationStep = {
  id: string;
  order: number;
  intent: string;
  targetComponentNodeIds: string[];
  targetInvariantId: string;
  targetAttackCaseId: string | null;
  targetTrustBoundaryId: string | null;
  validationMode: AISpecialistExecutionClassification;
  expectedEvidenceRefIds: string[];
};

export type AISpecialistPlan = {
  id: string;
  specialistId: string;
  targetComponentNodeIds: string[];
  targetInvariantIds: string[];
  targetAttackCaseIds: string[];
  validationSteps: AISpecialistValidationStep[];
  expectedEvidenceRefIds: string[];
  executionClassification: AISpecialistExecutionClassification;
  riskScope: string;
  maximumRuntimeBudgetMs: number;
  requiredAssumptions: string[];
  selectionRationale: string;
  truncatedByBudget: boolean;
};

export type AISpecialistObservation = {
  id: string;
  specialistId: string;
  componentNodeIds: string[];
  invariantId: string | null;
  attackCaseId: string | null;
  trustBoundaryId: string | null;
  evidenceRefIds: string[];
  confidence: "confirmed" | "highly_likely" | "likely" | "possible";
  status: AISpecialistObservationStatus;
  title: string;
  detail: string;
  businessImpactCandidate: string | null;
  rootCauseCandidate: string | null;
  executionClassification: AISpecialistExecutionClassification;
};

export type AISpecialistFailure = {
  code: "plan_error" | "analyze_error" | "timeout" | "budget_exceeded" | "internal";
  message: string;
};

export type AISpecialistMetadata = {
  providerFamily: string | null;
  tags: string[];
  planningPass: string;
};

export type AISpecialistResult = {
  specialistId: string;
  specialistName: string;
  status: AISpecialistStatus;
  eligibility: AISpecialistEligibility;
  plan: AISpecialistPlan | null;
  observations: AISpecialistObservation[];
  failure: AISpecialistFailure | null;
  summary: string;
  durationMs: number;
  metadata: AISpecialistMetadata;
};

export type AISpecialistExecutionSummary = {
  id: string;
  generatedAt: string;
  executionGraphId: string;
  specialistsTotal: number;
  specialistsCompleted: number;
  specialistsPartial: number;
  specialistsSkipped: number;
  specialistsFailed: number;
  observationCount: number;
  budgetConsumedMs: number;
  results: AISpecialistResult[];
  explainability: string[];
};

export type AISpecialistContext = {
  llmTeamRunId: string;
  organizationId: string;
  projectId: string;
  discovery: DiscoveryReport;
  inventory: AiDiscoveryInventory;
  graph: AIExecutionGraph;
  invariants: AIInvariantCollection;
  attacks: AIAttackCollection;
};

export interface AISecuritySpecialist {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly priority: number;
  readonly supportedComponents: DiscoveredAiComponentKind[];
  readonly supportedInvariantCategories: AIInvariantCategory[];
  readonly supportedAttackCategories: AIAttackCategory[];
  /** Declarative families; eligibility uses graph context, not package install alone. */
  readonly supportedProviders: readonly (NormalizedAiProviderFamily | "provider_agnostic")[];
  readonly supportedArchitectures: AISpecialistArchitecture[];

  canRun(context: AISpecialistContext): AISpecialistEligibility | Promise<AISpecialistEligibility>;

  plan(context: AISpecialistContext): Promise<AISpecialistPlan>;

  analyze(
    context: AISpecialistContext,
    plan: AISpecialistPlan
  ): Promise<Pick<AISpecialistResult, "observations">>;

  summarize(result: AISpecialistResult): string;
}

export const AI_SPECIALIST_MAX_VALIDATION_STEPS = 16;
export const AI_SPECIALIST_DEFAULT_RUNTIME_BUDGET_MS = 120_000;
export const AI_SPECIALIST_REGISTRY_MAX_BUDGET_MS = 600_000;
