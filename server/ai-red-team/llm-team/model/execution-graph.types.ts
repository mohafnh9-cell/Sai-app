import type { NormalizedAiProviderFamily } from "./normalize-provider";

export type AiEvidenceRef = {
  id: string;
  source: string;
  detail: string;
  confidence: number;
  discoveredComponentId?: string | null;
};

export type AIExecutionNodeKind =
  | "prompt"
  | "system_prompt"
  | "developer_prompt"
  | "user_prompt"
  | "retrieved_context"
  | "memory"
  | "embedding"
  | "vector_store"
  | "tool"
  | "function_call"
  | "llm"
  | "agent"
  | "sub_agent"
  | "mcp_server"
  | "mcp_client"
  | "knowledge_base"
  | "response"
  | "conversation"
  | "moderation"
  | "guardrail"
  | "external_api"
  | "user";

export type AIExecutionEdgeKind =
  | "uses"
  | "creates"
  | "retrieves"
  | "embeds"
  | "invokes"
  | "calls"
  | "delegates"
  | "routes"
  | "stores"
  | "reads"
  | "writes"
  | "filters"
  | "validates"
  | "executes"
  | "streams";

export type AIExecutionNode = {
  id: string;
  kind: AIExecutionNodeKind;
  label: string;
  providerFamily: NormalizedAiProviderFamily | "generic";
  confidence: number;
  discoveredComponentId: string | null;
  metadata: {
    tags: string[];
    evidence: AiEvidenceRef[];
  };
};

export type AIExecutionEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  kind: AIExecutionEdgeKind;
  label: string;
  traceRef: string;
};

export type AIExecutionPath = {
  id: string;
  nodeIds: string[];
  label: string;
  purpose: "canonical_happy_path" | "rag_path" | "tool_path" | "mcp_path" | "agent_path";
};

export type AIConversationStepKind =
  | "user_message"
  | "system_context"
  | "developer_instruction"
  | "retrieval"
  | "llm_turn"
  | "tool_result"
  | "assistant_response"
  | "memory_write";

export type AIConversationStep = {
  id: string;
  order: number;
  kind: AIConversationStepKind;
  nodeId: string;
  label: string;
};

export type AIConversation = {
  id: string;
  label: string;
  entryNodeId: string;
  steps: AIConversationStep[];
};

export type AIPromptBase = {
  id: string;
  role: "system" | "developer" | "user" | "generic";
  label: string;
  nodeId: string;
  templateHint: string | null;
};

export type AISystemPrompt = AIPromptBase & { role: "system" };
export type AIDeveloperPrompt = AIPromptBase & { role: "developer" };
export type AIUserPrompt = AIPromptBase & { role: "user" };
export type AIPrompt = AISystemPrompt | AIDeveloperPrompt | AIUserPrompt;

export type AITool = {
  id: string;
  name: string;
  nodeId: string;
  description: string;
  trustLevel: "untrusted" | "internal" | "external";
};

export type AIToolInvocation = {
  id: string;
  toolId: string;
  callerNodeId: string;
  targetNodeId: string | null;
};

export type AIFunctionCall = {
  id: string;
  toolInvocationId: string;
  functionName: string;
  nodeId: string;
};

export type AIRetrievalSource = {
  id: string;
  label: string;
  vectorStoreNodeId: string | null;
  knowledgeNodeId: string | null;
};

export type AIRetrieval = {
  id: string;
  label: string;
  sourceIds: string[];
  contextNodeId: string;
  embeddingNodeId: string | null;
};

export type AIVectorStore = {
  id: string;
  label: string;
  nodeId: string;
  providerFamily: NormalizedAiProviderFamily | "generic";
};

export type AIEmbedding = {
  id: string;
  label: string;
  nodeId: string;
  providerFamily: NormalizedAiProviderFamily | "generic";
};

export type AIMemory = {
  id: string;
  label: string;
  nodeId: string;
  scope: "session" | "user" | "global" | "unknown";
};

export type AIKnowledgeSource = {
  id: string;
  label: string;
  nodeId: string;
  sourceType: "documents" | "api" | "database" | "unknown";
};

export type AIAgentRole = "orchestrator" | "worker" | "router" | "critic" | "unknown";

export type AIAgent = {
  id: string;
  name: string;
  role: AIAgentRole;
  nodeId: string;
  frameworkFamily: NormalizedAiProviderFamily | "generic";
};

export type AIMultiAgentGraph = {
  id: string;
  agentIds: string[];
  edges: Array<{ fromAgentId: string; toAgentId: string; kind: "delegates" | "routes" }>;
};

export type AIWorkflow = {
  id: string;
  label: string;
  pathId: string;
  agentId: string | null;
};

export type AIExecutionContext = {
  id: string;
  projectId: string;
  organizationId: string;
  inventoryId: string;
  providerFamilies: NormalizedAiProviderFamily[];
  tags: string[];
};

export type AIBoundaryKind =
  | "trust"
  | "privilege"
  | "execution"
  | "data"
  | "memory"
  | "retrieval"
  | "tool";

export type AIBoundary = {
  id: string;
  kind: AIBoundaryKind;
  label: string;
  protectedNodeIds: string[];
  crossingNodeIds: string[];
};

export type AITrustBoundary = AIBoundary & { kind: "trust" };
export type AIPrivilegeBoundary = AIBoundary & { kind: "privilege" };

export type AIResponsePipeline = {
  id: string;
  llmNodeId: string;
  moderationNodeId: string | null;
  guardrailNodeId: string | null;
  responseNodeId: string;
  memoryNodeId: string | null;
};

export type AIOutput = {
  id: string;
  responseNodeId: string;
  label: string;
  streamed: boolean;
};

export type AIExecutionGraphValidationCode =
  | "disconnected_node"
  | "cycle_detected"
  | "dangling_tool"
  | "dangling_prompt"
  | "invalid_execution_chain"
  | "missing_trust_boundary"
  | "broken_relationship"
  | "duplicate_node"
  | "orphan_memory"
  | "orphan_retrieval";

export type AIExecutionGraphValidationIssue = {
  code: AIExecutionGraphValidationCode;
  message: string;
  nodeId?: string | null;
  edgeId?: string | null;
};

export type AIExecutionGraph = {
  id: string;
  schemaVersion: 1;
  generatedAt: string;
  context: AIExecutionContext;
  nodes: AIExecutionNode[];
  edges: AIExecutionEdge[];
  paths: AIExecutionPath[];
  conversations: AIConversation[];
  prompts: AIPrompt[];
  tools: AITool[];
  toolInvocations: AIToolInvocation[];
  functionCalls: AIFunctionCall[];
  retrievals: AIRetrieval[];
  retrievalSources: AIRetrievalSource[];
  vectorStores: AIVectorStore[];
  embeddings: AIEmbedding[];
  memories: AIMemory[];
  knowledgeSources: AIKnowledgeSource[];
  agents: AIAgent[];
  multiAgentGraphs: AIMultiAgentGraph[];
  workflows: AIWorkflow[];
  boundaries: AIBoundary[];
  responsePipelines: AIResponsePipeline[];
  outputs: AIOutput[];
  validationIssues: AIExecutionGraphValidationIssue[];
};
