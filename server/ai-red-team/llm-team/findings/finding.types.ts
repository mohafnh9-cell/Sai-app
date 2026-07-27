import type { AIAttackCategory } from "../attacks/attack.types";
import type { AIExecutionClassification } from "../runtime/runtime.types";
import type { CoreFindingSeverity } from "../../core/severity/severity.types";
import type { CoreFindingConfidence } from "../../core/confidence/confidence.types";
import type { CoreFindingStatus } from "../../core/findings/finding.types";
import type { CoreEvidence } from "../../core/evidence/evidence.types";

export type AIFindingSeverity = CoreFindingSeverity;

export type AIFindingConfidence = CoreFindingConfidence;

export type AIFindingStatus = CoreFindingStatus;

export type AIFindingCategory =
  | "prompt_injection"
  | "indirect_prompt_injection"
  | "system_prompt_leakage"
  | "developer_prompt_leakage"
  | "tool_abuse"
  | "function_abuse"
  | "memory_leakage"
  | "memory_poisoning"
  | "conversation_isolation_failure"
  | "cross_tenant_conversation_access"
  | "rag_poisoning"
  | "retrieved_context_manipulation"
  | "embedding_poisoning"
  | "vector_store_poisoning"
  | "mcp_trust_violation"
  | "mcp_tool_abuse"
  | "agent_impersonation"
  | "agent_delegation_failure"
  | "guardrail_failure"
  | "moderation_failure"
  | "privilege_escalation"
  | "external_api_trust_violation";

export type AIFindingEvidenceSource =
  | "runtime"
  | "invariant"
  | "attack"
  | "specialist"
  | "discovery";

export type AIFindingEvidence = CoreEvidence<
  "runtime" | "invariant" | "attack" | "specialist" | "discovery"
> & {
  refId: string | null;
  executionId: string | null;
};

export type AIFindingImpact = {
  summary: string;
  businessImpact: string;
  trustImpact: string;
  affectedAssets: string[];
};

export type AIFindingRecommendation = {
  id: string;
  kind:
    | "restore_invariant"
    | "prompt_hardening"
    | "tool_authorization"
    | "memory_isolation"
    | "retrieval_integrity"
    | "guardrail_enforcement"
    | "agent_isolation"
    | "mcp_isolation";
  statement: string;
};

export type AttackCapability =
  | "anonymous_user"
  | "authenticated_user"
  | "workspace_member"
  | "organization_admin"
  | "prompt_author"
  | "document_author"
  | "knowledge_base_editor"
  | "tool_owner"
  | "agent_owner"
  | "mcp_server_owner"
  | "compromised_tool"
  | "compromised_mcp_server"
  | "external_api_controller"
  | "insider";

export type AttackEnvironmentRequirement = {
  id: string;
  label: string;
  required: boolean;
};

export type AttackArchitectureRequirement = {
  architecture: string;
  required: boolean;
};

export type AttackStateRequirement = {
  layer: "memory" | "conversation" | "retrieval" | "tool" | "mcp" | "agent";
  description: string;
  required: boolean;
};

export type AttackAssetRequirement = {
  assetKind: string;
  nodeIds: string[];
  required: boolean;
};

export type AttackBoundaryRequirement = {
  boundaryId: string;
  boundaryKind: string;
  required: boolean;
};

export type AttackPreconditions = {
  requiredAttackerCapability: AttackCapability;
  requiredTrustBoundaries: AttackBoundaryRequirement[];
  requiredComponents: string[];
  requiredProviders: string[];
  requiredModelProfile: string;
  requiredArchitecture: AttackArchitectureRequirement[];
  requiredPromptLayers: string[];
  requiredMemoryState: AttackStateRequirement[];
  requiredConversationState: AttackStateRequirement[];
  requiredRetrievalState: AttackStateRequirement[];
  requiredToolPermissions: string[];
  requiredFunctionPermissions: string[];
  requiredMcpConfiguration: string[];
  requiredAgentTopology: string[];
  requiredExternalDependencies: string[];
  requiredEnvironment: AttackEnvironmentRequirement[];
  requiredFeatureFlags: string[];
  requiredSecrets: string[];
  requiredConfiguration: string[];
  requiredRuntimeMode: string;
  requiredDataFlow: string[];
  requiredExecutionPathId: string | null;
  requiredGraphNodeIds: string[];
  requiredGraphEdgeIds: string[];
  unsupportedConditions: string[];
  blockingConditions: string[];
  optionalConditions: string[];
};

export type AIReplayAction = {
  id: string;
  order: number;
  kind: "prompt_turn" | "tool_invoke" | "memory_write" | "retrieval" | "assert_invariant" | "mcp_call";
  label: string;
  nodeId: string | null;
};

export type AIReplayEvidence = {
  id: string;
  detail: string;
  refId: string | null;
};

export type AIReplaySequence = {
  id: string;
  steps: AIReplayAction[];
};

export type AIReplayPlan = {
  id: string;
  findingId: string;
  preconditions: AttackPreconditions;
  promptSequence: string[];
  conversationState: string[];
  memoryState: string[];
  retrievedContext: string[];
  toolState: string[];
  sequence: AIReplaySequence;
  expectedInvariantViolationId: string;
  expectedEvidence: AIReplayEvidence[];
  expectedOutcome: string;
  executable: false;
};

export type AIFixContext = {
  affectedComponentNodeIds: string[];
  affectedTrustBoundaryId: string;
  invariantToRestoreId: string;
  invariantToRestoreKey: string;
  promptLayer: string | null;
  memoryLayer: string | null;
  toolLayer: string | null;
  retrievalLayer: string | null;
  guardrailRecommendation: string | null;
  isolationRecommendation: string | null;
  validationRecommendation: string;
  recommendations: AIFindingRecommendation[];
};

export type AIFindingCorrelation = {
  keys: string[];
  trustBoundaryId: string;
  invariantId: string;
  invariantKey: string;
  attackCaseId: string | null;
  attackKey: string | null;
  executionPathId: string | null;
  rootCause: string;
  affectedComponentNodeIds: string[];
};

export type AIFindingMetadata = {
  llmTeamRunId: string | null;
  executionId: string;
  planId: string;
  specialistId: string;
  executionMode: string;
  executionClassification: AIExecutionClassification;
  attackCategory: AIAttackCategory | null;
  generatedAt: string;
  providerFamily: string | null;
};

export type AIFindingTraceability = {
  discoveryEvidenceRefIds: string[];
  graphNodeIds: string[];
  graphEdgeIds: string[];
  trustBoundaryId: string;
  invariantId: string;
  invariantKey: string;
  attackCaseId: string | null;
  attackPreconditionsId: string;
  specialistId: string;
  runtimeExecutionId: string;
  replayPlanId: string;
};

export type AIFinding = {
  findingId: string;
  findingKey: string;
  title: string;
  description: string;
  category: AIFindingCategory;
  severity: AIFindingSeverity;
  confidence: AIFindingConfidence;
  status: AIFindingStatus;
  impact: AIFindingImpact;
  evidence: AIFindingEvidence[];
  attackPreconditions: AttackPreconditions;
  replayPlan: AIReplayPlan;
  fixContext: AIFixContext;
  correlation: AIFindingCorrelation;
  traceability: AIFindingTraceability;
  specialistIds: string[];
  executionSummary: string;
  metadata: AIFindingMetadata;
};

export type AIFindingValidationIssue = {
  findingId: string;
  code:
    | "missing_runtime_evidence"
    | "missing_invariant"
    | "missing_graph_nodes"
    | "missing_replay"
    | "missing_fix_context"
    | "missing_preconditions"
    | "unsupported_confidence";
  message: string;
};

export type AIFindingCollection = {
  id: string;
  executionGraphId: string;
  generatedAt: string;
  findings: AIFinding[];
  validationIssues: AIFindingValidationIssue[];
};

export type AIFindingBuildInput = {
  llmTeamRunId?: string | null;
  discovery: import("../../discovery/types").DiscoveryReport;
  inventory?: import("../discovery/discovery.types").AiDiscoveryInventory;
  graph: import("../model/execution-graph.types").AIExecutionGraph;
  invariants: import("../invariants/invariant.types").AIInvariantCollection;
  attacks: import("../attacks/attack.types").AIAttackCollection;
  specialistSummary: import("../specialists/specialist.types").AISpecialistExecutionSummary;
  runtimeSummary: import("../runtime/runtime.types").AIRuntimeSummary;
};

export const ATTACK_TO_FINDING_CATEGORY: Partial<Record<AIAttackCategory, AIFindingCategory>> = {
  prompt_injection: "prompt_injection",
  indirect_prompt_injection: "indirect_prompt_injection",
  instruction_override: "prompt_injection",
  system_prompt_extraction: "system_prompt_leakage",
  developer_prompt_extraction: "developer_prompt_leakage",
  tool_abuse: "tool_abuse",
  unauthorized_tool_invocation: "tool_abuse",
  parameter_injection: "function_abuse",
  function_call_manipulation: "function_abuse",
  memory_leakage: "memory_leakage",
  memory_cross_tenant_access: "cross_tenant_conversation_access",
  memory_poisoning: "memory_poisoning",
  conversation_hijacking: "conversation_isolation_failure",
  cross_conversation_injection: "conversation_isolation_failure",
  rag_poisoning: "rag_poisoning",
  retrieved_context_manipulation: "retrieved_context_manipulation",
  embedding_poisoning: "embedding_poisoning",
  vector_store_poisoning: "vector_store_poisoning",
  mcp_trust_boundary_violation: "mcp_trust_violation",
  mcp_tool_abuse: "mcp_tool_abuse",
  mcp_prompt_injection: "mcp_trust_violation",
  agent_impersonation: "agent_impersonation",
  agent_delegation_abuse: "agent_delegation_failure",
  sub_agent_manipulation: "agent_delegation_failure",
  guardrail_bypass: "guardrail_failure",
  moderation_bypass: "moderation_failure",
  privilege_escalation: "privilege_escalation",
  external_api_trust_abuse: "external_api_trust_violation",
};
