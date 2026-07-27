import type { AIInvariantCategory, AIInvariantConfidence } from "../invariants/invariant.types";
import type { AIExecutionNodeKind } from "../model/execution-graph.types";

export type AIAttackCategory =
  | "prompt_injection"
  | "indirect_prompt_injection"
  | "cross_conversation_injection"
  | "instruction_override"
  | "instruction_shadowing"
  | "system_prompt_extraction"
  | "developer_prompt_extraction"
  | "context_manipulation"
  | "context_overflow"
  | "context_truncation"
  | "conversation_hijacking"
  | "memory_poisoning"
  | "memory_leakage"
  | "memory_cross_tenant_access"
  | "memory_replay"
  | "rag_poisoning"
  | "retrieved_context_manipulation"
  | "embedding_poisoning"
  | "vector_store_poisoning"
  | "tool_abuse"
  | "unauthorized_tool_invocation"
  | "function_call_manipulation"
  | "parameter_injection"
  | "tool_result_injection"
  | "mcp_prompt_injection"
  | "mcp_tool_abuse"
  | "mcp_trust_boundary_violation"
  | "agent_impersonation"
  | "sub_agent_manipulation"
  | "agent_delegation_abuse"
  | "agent_loop_creation"
  | "agent_coordination_manipulation"
  | "external_api_trust_abuse"
  | "guardrail_bypass"
  | "moderation_bypass"
  | "output_manipulation"
  | "streaming_manipulation"
  | "privilege_escalation"
  | "multi_step_ai_attack_chains";

export type AIAttackConfidence =
  | "confirmed"
  | "highly_likely"
  | "likely"
  | "possible"
  | "unsupported";

export type AIAttackerCapability =
  | "anonymous_user"
  | "authenticated_user"
  | "workspace_member"
  | "organization_admin"
  | "malicious_document_author"
  | "malicious_rag_source"
  | "compromised_tool"
  | "compromised_mcp_server"
  | "compromised_agent"
  | "external_api_manipulator"
  | "insider";

export type AIAttackEvidenceSource =
  | "invariant"
  | "execution_graph"
  | "trust_boundary"
  | "execution_path"
  | "discovery";

export type AIAttackEvidence = {
  id: string;
  source: AIAttackEvidenceSource;
  detail: string;
  confidence: number;
  refId?: string | null;
};

export type AIAttackAssumption = {
  id: string;
  statement: string;
  required: boolean;
  capability: AIAttackerCapability;
};

export type AIAttackActionKind =
  | "inject_prompt"
  | "manipulate_context"
  | "poison_source"
  | "invoke_tool"
  | "manipulate_parameters"
  | "inject_tool_result"
  | "extract_prompt"
  | "bypass_filter"
  | "delegate_agent"
  | "replay_memory"
  | "cross_boundary"
  | "chain_step";

export type AIAttackAction = {
  id: string;
  kind: AIAttackActionKind;
  label: string;
  attackerCapability: AIAttackerCapability;
};

export type AIAttackStep = {
  order: number;
  nodeId: string | null;
  nodeKind: AIExecutionNodeKind | "attack" | "invariant_violation";
  label: string;
  action: AIAttackAction;
  graphEdgeId: string | null;
  marksInvariantViolation: boolean;
  note: string | null;
};

export type AIAttackSequence = {
  id: string;
  executionPathId: string | null;
  graphNodeIds: string[];
  graphEdgeIds: string[];
  steps: AIAttackStep[];
  invariantViolationSummary: string;
  expectedConsequence: string;
};

export type AIAttackMetadata = {
  providerFamily: string | null;
  strategyId: string;
  specialistPackId: string | null;
  tags: string[];
  generationPass: string;
};

export type AIAttackCase = {
  id: string;
  attackKey: string;
  title: string;
  description: string;
  category: AIAttackCategory;
  targetInvariantId: string;
  targetInvariantKey: string;
  targetTrustBoundaryId: string;
  targetComponentNodeIds: string[];
  manipulatedComponentKind: AIExecutionNodeKind | "multi";
  executionGraphId: string;
  sequence: AIAttackSequence;
  attackerCapability: AIAttackerCapability;
  expectedImpact: string;
  confidence: AIAttackConfidence;
  evidence: AIAttackEvidence[];
  assumptions: AIAttackAssumption[];
  suggestedRuntimeStrategy: string;
  potentialMitigationCategory: string;
  metadata: AIAttackMetadata;
};

export type AIAttackValidationCode =
  | "missing_invariant"
  | "missing_boundary"
  | "missing_graph_nodes"
  | "impossible_path"
  | "impossible_topology"
  | "unsupported_assumption_only"
  | "speculative"
  | "missing_component"
  | "provider_specific";

export type AIAttackValidationIssue = {
  id: string;
  attackCaseId: string;
  code: AIAttackValidationCode;
  message: string;
};

export type AIAttackCollection = {
  id: string;
  executionGraphId: string;
  invariantCollectionId: string;
  cases: AIAttackCase[];
  validationIssues: AIAttackValidationIssue[];
  generatedAt: string;
};

export type AIAttackGenerationResult = {
  collection: AIAttackCollection;
  plannedInvariantCount: number;
  generatedCount: number;
  acceptedCount: number;
  rejectedCount: number;
};

export type AIAttackGenerationInput = {
  graph: import("../model/execution-graph.types").AIExecutionGraph;
  invariants: import("../invariants/invariant.types").AIInvariantCollection;
};

/** Extension point for future specialist packs — register without changing the core generator. */
export type AIAttackStrategy = {
  id: string;
  invariantCategories: AIInvariantCategory[];
  generate: (ctx: AIAttackStrategyContext) => AIAttackCase[];
};

export type AIAttackStrategyContext = {
  graph: import("../model/execution-graph.types").AIExecutionGraph;
  invariant: import("../invariants/invariant.types").AIInvariant;
};

export type InvariantConfidence = AIInvariantConfidence;
