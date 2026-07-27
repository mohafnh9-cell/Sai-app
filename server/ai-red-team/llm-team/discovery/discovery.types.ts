/** RT10 Slice 1 output — discovered AI attack surface (provider-agnostic). */
export type AiDiscoveryEvidenceSource =
  | "discovery_report"
  | "technology_graph"
  | "package_manifest"
  | "attack_surface"
  | "project_summary"
  | "dependency_scan";

export type AiDiscoveryEvidence = {
  id: string;
  source: AiDiscoveryEvidenceSource;
  detail: string;
  confidence: number;
  refId?: string | null;
};

export type DiscoveredAiComponentKind =
  | "llm_provider"
  | "inference_host"
  | "ai_sdk"
  | "agent_framework"
  | "orchestration"
  | "embedding_model"
  | "vector_store"
  | "knowledge_base"
  | "mcp_server"
  | "mcp_client"
  | "tool_registry"
  | "memory_store"
  | "moderation"
  | "guardrail"
  | "router";

export type DiscoveredAiComponent = {
  id: string;
  kind: DiscoveredAiComponentKind;
  label: string;
  /** Normalized provider/framework family (see model/normalize-provider). */
  providerFamily: string;
  confidence: number;
  evidence: AiDiscoveryEvidence[];
  tags: string[];
};

export type AiDiscoverySignals = {
  hasLlmProvider: boolean;
  hasAiSdk: boolean;
  hasAgentFramework: boolean;
  hasMcpSurface: boolean;
  hasVectorStore: boolean;
  hasEmbeddings: boolean;
  hasMemoryHint: boolean;
  hasRagHint: boolean;
  hasMultiAgentHint: boolean;
  providerFamilies: string[];
};

export type AiDiscoveryInventory = {
  id: string;
  generatedAt: string;
  projectId: string;
  organizationId: string;
  signals: AiDiscoverySignals;
  components: DiscoveredAiComponent[];
};
