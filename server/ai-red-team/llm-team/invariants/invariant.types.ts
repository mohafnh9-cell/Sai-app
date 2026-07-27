export type AIInvariantConfidence =
  | "explicit"
  | "confirmed"
  | "strongly_inferred"
  | "inferred"
  | "assumed"
  | "unsupported";

export type AIInvariantCategory =
  | "prompt_integrity"
  | "instruction_integrity"
  | "instruction_priority"
  | "system_prompt_integrity"
  | "developer_prompt_integrity"
  | "conversation_isolation"
  | "conversation_continuity"
  | "tool_authorization"
  | "tool_isolation"
  | "tool_parameter_integrity"
  | "tool_result_validation"
  | "retrieval_integrity"
  | "retrieval_authenticity"
  | "knowledge_trust"
  | "memory_isolation"
  | "memory_freshness"
  | "memory_ownership"
  | "embedding_integrity"
  | "context_integrity"
  | "output_validation"
  | "output_filtering"
  | "guardrail_integrity"
  | "moderation_integrity"
  | "privilege_separation"
  | "trust_boundary_preservation"
  | "agent_isolation"
  | "sub_agent_isolation"
  | "agent_delegation"
  | "mcp_isolation"
  | "function_call_integrity"
  | "external_api_trust"
  | "streaming_integrity"
  | "multi_agent_coordination";

export type AIInvariantEvidenceSource =
  | "execution_graph"
  | "execution_path"
  | "trust_boundary"
  | "prompt_node"
  | "tool_node"
  | "memory_node"
  | "retrieval_path"
  | "agent_graph"
  | "mcp_node"
  | "response_pipeline"
  | "conversation_flow"
  | "graph_edge";

export type AIInvariantEvidence = {
  id: string;
  source: AIInvariantEvidenceSource;
  detail: string;
  confidence: number;
  refId?: string | null;
};

export type AIProtectedValueKind =
  | "trust"
  | "integrity"
  | "confidentiality"
  | "authorization"
  | "authenticity"
  | "availability";

export type AIInvariantRelationship = {
  protectedComponentNodeIds: string[];
  protectedBoundaryId: string;
  relatedPromptNodeIds: string[];
  relatedToolNodeIds: string[];
  relatedMemoryNodeIds: string[];
  relatedRetrievalNodeIds: string[];
  relatedAgentIds: string[];
  relatedMcpNodeIds: string[];
  executionPathId: string | null;
  graphNodeIds: string[];
  graphEdgeIds: string[];
};

export type AIInvariantMetadata = {
  providerFamily: string | null;
  tags: string[];
  extractionPass: string;
};

export type AIInvariant = {
  id: string;
  invariantKey: string;
  title: string;
  description: string;
  category: AIInvariantCategory;
  protectedTrustBoundaryId: string;
  protectedComponents: string[];
  protectedAssets: string[];
  protectedValueKind: AIProtectedValueKind;
  protectedValueDescription: string;
  executionGraphId: string;
  relationships: AIInvariantRelationship;
  evidence: AIInvariantEvidence[];
  confidence: AIInvariantConfidence;
  dependencies: string[];
  relatedInvariantKeys: string[];
  assumptions: string[];
  metadata: AIInvariantMetadata;
};

export type AIInvariantGroup = {
  id: string;
  label: string;
  category: AIInvariantCategory | "mixed";
  boundaryId: string | null;
  invariantIds: string[];
};

export type AIInvariantViolationCode =
  | "missing_trust_boundary_ref"
  | "missing_graph_nodes"
  | "missing_evidence"
  | "unsupported_confidence"
  | "missing_prompt_hierarchy"
  | "missing_guardrails"
  | "orphan_memory"
  | "unprotected_retrieval"
  | "broken_delegation"
  | "broken_agent_isolation"
  | "broken_mcp_isolation"
  | "dangling_tool_permissions"
  | "broken_privilege_chain";

export type AIInvariantViolation = {
  id: string;
  invariantId: string | null;
  code: AIInvariantViolationCode;
  message: string;
};

export type AIInvariantCollection = {
  id: string;
  executionGraphId: string;
  groups: AIInvariantGroup[];
  invariants: AIInvariant[];
  validationViolations: AIInvariantViolation[];
  extractedAt: string;
};

export type AIInvariantExtractionInput = {
  graph: import("../model/execution-graph.types").AIExecutionGraph;
};
