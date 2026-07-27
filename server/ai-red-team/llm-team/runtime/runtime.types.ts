import type { AIAttackCategory } from "../attacks/attack.types";
import type { AISpecialistExecutionSummary } from "../specialists/specialist.types";

export type AIExecutionMode =
  | "static_analysis"
  | "conversation_simulation"
  | "mock_llm"
  | "synthetic_tool"
  | "synthetic_mcp"
  | "synthetic_agent"
  | "synthetic_rag"
  | "staging_candidate"
  | "blocked"
  | "unsupported";

export type AIExecutionClassification =
  | "confirmed"
  | "highly_likely"
  | "likely"
  | "possible"
  | "unsupported"
  | "inconclusive"
  | "blocked";

export type AIExecutionStatus =
  | "completed"
  | "failed"
  | "skipped"
  | "blocked"
  | "timeout"
  | "budget_exceeded"
  | "partial";

export type AIExecutionFailureCode =
  | "timeout"
  | "budget_exhaustion"
  | "simulation_failure"
  | "unsupported_provider"
  | "unsupported_architecture"
  | "malformed_prompt"
  | "graph_inconsistency"
  | "production_forbidden"
  | "invalid_plan";

export type AIRuntimeProfile = {
  id: string;
  label: string;
  allowStagingCandidate: boolean;
  defaultMode: AIExecutionMode;
};

export type AIRuntimeBudget = {
  maxPlans: number;
  maxPrompts: number;
  maxToolInvocations: number;
  maxRuntimeMs: number;
  maxSimulations: number;
};

export type AIRuntimeLimits = {
  perPlanTimeoutMs: number;
  perPlanMaxPrompts: number;
  perPlanMaxToolInvocations: number;
};

export type AIExecutionEvidence = {
  id: string;
  source:
    | "runtime_simulation"
    | "synthetic_llm"
    | "execution_graph"
    | "invariant"
    | "attack_hypothesis"
    | "specialist";
  detail: string;
  confidence: number;
  refId?: string | null;
};

export type AIExecutionStep = {
  id: string;
  order: number;
  mode: AIExecutionMode;
  label: string;
  nodeId: string | null;
  attackStepOrder: number | null;
  syntheticOutputDigest: string | null;
  note: string | null;
};

export type AIExecutionPlan = {
  id: string;
  specialistPlanId: string;
  specialistId: string;
  specialistStepId: string;
  targetAttackCaseId: string | null;
  targetInvariantId: string;
  targetTrustBoundaryId: string | null;
  targetComponentNodeIds: string[];
  executionPathId: string | null;
  attackSequenceStepIds: string[];
  expectedViolatedInvariantIds: string[];
  expectedEvidenceRefIds: string[];
  executionMode: AIExecutionMode;
  simulationEngine: string;
  maxRuntimeMs: number;
  maxPromptCount: number;
  maxToolInvocations: number;
  rollbackStrategy: "synthetic_reset" | "none";
  assumptions: string[];
};

export type AIExecutionResult = {
  executionId: string;
  planId: string;
  specialistId: string;
  attackCaseId: string | null;
  invariantId: string;
  executionMode: AIExecutionMode;
  status: AIExecutionStatus;
  classification: AIExecutionClassification;
  confidence: AIExecutionClassification;
  evidence: AIExecutionEvidence[];
  executedSteps: AIExecutionStep[];
  violatedInvariantId: string | null;
  expectedImpact: string | null;
  failureCode: AIExecutionFailureCode | null;
  failureReason: string | null;
  promptsUsed: number;
  toolInvocationsUsed: number;
  conversationsUsed: number;
  simulationsUsed: number;
  durationMs: number;
};

export type AIRuntimeBudgetUsage = {
  plansExecuted: number;
  promptsUsed: number;
  toolInvocationsUsed: number;
  runtimeMsUsed: number;
  simulationsUsed: number;
};

export type AIRuntimeSummary = {
  id: string;
  generatedAt: string;
  profileId: string;
  executionGraphId: string;
  plansTotal: number;
  plansCompleted: number;
  plansPartial: number;
  plansFailed: number;
  plansBlocked: number;
  plansSkipped: number;
  plansTimeout: number;
  promptCount: number;
  toolCount: number;
  conversationCount: number;
  executionDurationMs: number;
  runtimeBudgetMs: number;
  simulationCount: number;
  skippedExecutions: number;
  blockedExecutions: number;
  failedExecutions: number;
  budgetUsage: AIRuntimeBudgetUsage;
  partialReason: string | null;
  results: AIExecutionResult[];
};

export type AIRuntimeContext = {
  llmTeamRunId: string;
  organizationId: string;
  projectId: string;
  graph: import("../model/execution-graph.types").AIExecutionGraph;
  invariants: import("../invariants/invariant.types").AIInvariantCollection;
  attacks: import("../attacks/attack.types").AIAttackCollection;
  specialistSummary: AISpecialistExecutionSummary;
  profile: AIRuntimeProfile;
  budget: AIRuntimeBudget;
  limits: AIRuntimeLimits;
};

export type AIRuntimeExecutionInput = {
  context: AIRuntimeContext;
  plans?: AIExecutionPlan[];
};

export const ATTACK_SIMULATION_ENGINE: Partial<Record<AIAttackCategory, string>> = {
  prompt_injection: "prompt_injection",
  indirect_prompt_injection: "indirect_prompt_injection",
  tool_abuse: "tool_abuse",
  unauthorized_tool_invocation: "tool_abuse",
  parameter_injection: "function_calling",
  function_call_manipulation: "function_calling",
  memory_poisoning: "memory_poisoning",
  memory_leakage: "conversation_leakage",
  memory_cross_tenant_access: "conversation_leakage",
  rag_poisoning: "rag_poisoning",
  retrieved_context_manipulation: "rag_poisoning",
  vector_store_poisoning: "vector_store_manipulation",
  embedding_poisoning: "rag_poisoning",
  mcp_prompt_injection: "mcp_prompt_injection",
  mcp_tool_abuse: "mcp_prompt_injection",
  agent_delegation_abuse: "agent_delegation",
  agent_impersonation: "agent_delegation",
  sub_agent_manipulation: "multi_agent_communication",
  agent_coordination_manipulation: "multi_agent_communication",
  guardrail_bypass: "guardrail_bypass",
  moderation_bypass: "moderation_bypass",
  streaming_manipulation: "streaming_responses",
};
