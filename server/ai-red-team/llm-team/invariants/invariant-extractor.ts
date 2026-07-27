import type {
  AIInvariant,
  AIInvariantCategory,
  AIInvariantCollection,
  AIInvariantEvidence,
  AIInvariantGroup,
  AIInvariantRelationship,
} from "./invariant.types";
import type { AIExecutionGraph } from "../model/execution-graph.types";
import {
  classifyAiInvariantConfidence,
  maxEvidenceConfidence,
  mergeAiInvariantEvidence,
} from "./invariant-confidence";
import { validateAiInvariantCollection } from "./invariant-validator";
import { stableAiId } from "../model/stable-id";
import {
  boundaryByKind,
  canonicalPathId,
  edgesTouching,
  evidenceFromGraph,
  nodeIdsByKind,
} from "./invariant-graph-helpers";

type BuildInput = {
  invariantKey: string;
  title: string;
  description: string;
  category: AIInvariantCategory;
  boundaryId: string;
  protectedValueDescription: string;
  protectedValueKind: AIInvariant["protectedValueKind"];
  protectedAssets: string[];
  relationships: Omit<AIInvariantRelationship, "protectedBoundaryId"> & {
    protectedBoundaryId?: string;
  };
  evidence: AIInvariantEvidence[];
  confidenceInput: Parameters<typeof classifyAiInvariantConfidence>[0];
  dependencies?: string[];
  relatedKeys?: string[];
  assumptions?: string[];
  tags?: string[];
};

function buildInvariant(graph: AIExecutionGraph, input: BuildInput): AIInvariant {
  const evidence = mergeAiInvariantEvidence(input.evidence);
  const confidence = classifyAiInvariantConfidence({
    ...input.confidenceInput,
    evidenceMax: maxEvidenceConfidence(evidence),
  });

  const relationships: AIInvariantRelationship = {
    protectedComponentNodeIds: input.relationships.protectedComponentNodeIds,
    protectedBoundaryId: input.boundaryId,
    relatedPromptNodeIds: input.relationships.relatedPromptNodeIds,
    relatedToolNodeIds: input.relationships.relatedToolNodeIds,
    relatedMemoryNodeIds: input.relationships.relatedMemoryNodeIds,
    relatedRetrievalNodeIds: input.relationships.relatedRetrievalNodeIds,
    relatedAgentIds: input.relationships.relatedAgentIds,
    relatedMcpNodeIds: input.relationships.relatedMcpNodeIds,
    executionPathId: input.relationships.executionPathId,
    graphNodeIds: input.relationships.graphNodeIds,
    graphEdgeIds: input.relationships.graphEdgeIds,
  };

  return {
    id: stableAiId(`invariant:${input.invariantKey}`),
    invariantKey: input.invariantKey,
    title: input.title,
    description: input.description,
    category: input.category,
    protectedTrustBoundaryId: input.boundaryId,
    protectedComponents: input.protectedAssets,
    protectedAssets: input.protectedAssets,
    protectedValueKind: input.protectedValueKind,
    protectedValueDescription: input.protectedValueDescription,
    executionGraphId: graph.id,
    relationships,
    evidence,
    confidence,
    dependencies: input.dependencies ?? [],
    relatedInvariantKeys: input.relatedKeys ?? [],
    assumptions: input.assumptions ?? [],
    metadata: {
      providerFamily: null,
      tags: input.tags ?? [],
      extractionPass: "rt10_slice3",
    },
  };
}

function dedupeInvariants(invariants: AIInvariant[]): AIInvariant[] {
  const byKey = new Map<string, AIInvariant>();
  for (const inv of invariants) {
    const existing = byKey.get(inv.invariantKey);
    if (!existing || inv.evidence.length > existing.evidence.length) {
      byKey.set(inv.invariantKey, inv);
    }
  }
  return [...byKey.values()].sort((a, b) => a.invariantKey.localeCompare(b.invariantKey));
}

export function extractAiTrustInvariants(input: {
  graph: AIExecutionGraph;
}): AIInvariantCollection {
  const graph = input.graph;
  const invariants: AIInvariant[] = [];

  if (graph.nodes.length === 0) {
    return validateAiInvariantCollection({
      id: stableAiId(`inv-collection:${graph.id}`),
      executionGraphId: graph.id,
      groups: [],
      invariants: [],
      validationViolations: [],
      extractedAt: new Date().toISOString(),
    });
  }

  const pathId = canonicalPathId(graph);
  const trustBoundary = boundaryByKind(graph, "trust");
  const toolBoundary = boundaryByKind(graph, "tool");
  const memoryBoundary = boundaryByKind(graph, "memory");
  const retrievalBoundary = boundaryByKind(graph, "retrieval");
  const privilegeBoundary = boundaryByKind(graph, "privilege");

  const systemPromptIds = nodeIdsByKind(graph, "system_prompt");
  const developerPromptIds = nodeIdsByKind(graph, "developer_prompt");
  const userPromptIds = nodeIdsByKind(graph, "user_prompt");
  const llmIds = nodeIdsByKind(graph, "llm");
  const toolIds = nodeIdsByKind(graph, "tool");
  const memoryIds = nodeIdsByKind(graph, "memory");
  const retrievalIds = nodeIdsByKind(graph, "retrieved_context");
  const mcpServerIds = nodeIdsByKind(graph, "mcp_server");
  const mcpClientIds = nodeIdsByKind(graph, "mcp_client");
  const moderationIds = nodeIdsByKind(graph, "moderation");
  const guardrailIds = nodeIdsByKind(graph, "guardrail");
  const responseIds = nodeIdsByKind(graph, "response");
  const externalIds = nodeIdsByKind(graph, "external_api");

  if (trustBoundary && systemPromptIds[0] && userPromptIds[0]) {
    invariants.push(
      buildInvariant(graph, {
        invariantKey: "prompt:instruction_priority:system_before_user",
        title: "Instruction priority — system before user influence",
        description:
          "System instructions must retain priority over user-supplied content before LLM execution.",
        category: "instruction_priority",
        boundaryId: trustBoundary.id,
        protectedValueKind: "integrity",
        protectedValueDescription: "Instruction hierarchy and prompt integrity",
        protectedAssets: ["system_prompt", "user_prompt"],
        relationships: {
          protectedComponentNodeIds: [systemPromptIds[0]!, userPromptIds[0]!],
          relatedPromptNodeIds: [...systemPromptIds, ...developerPromptIds, ...userPromptIds],
          relatedToolNodeIds: [],
          relatedMemoryNodeIds: [],
          relatedRetrievalNodeIds: retrievalIds,
          relatedAgentIds: graph.agents.map((a) => a.id),
          relatedMcpNodeIds: [...mcpClientIds, ...mcpServerIds],
          executionPathId: pathId,
          graphNodeIds: [...systemPromptIds, ...userPromptIds, ...llmIds],
          graphEdgeIds: graph.edges
            .filter((e) => e.kind === "routes" || e.kind === "executes")
            .map((e) => e.id),
        },
        evidence: [
          evidenceFromGraph("conversation_flow", "Conversation steps order system before LLM turn", 0.88),
          evidenceFromGraph("trust_boundary", trustBoundary.label, 0.9, trustBoundary.id),
        ],
        confidenceInput: { hasBoundary: true, hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
        tags: ["prompt", "hierarchy"],
      })
    );
  }

  for (const promptId of systemPromptIds) {
    invariants.push(
      buildInvariant(graph, {
        invariantKey: `prompt:system_prompt_integrity:${promptId.slice(0, 8)}`,
        title: "System prompt integrity",
        description: "System prompt content must not be silently overridden by untrusted inputs.",
        category: "system_prompt_integrity",
        boundaryId: trustBoundary?.id ?? graph.boundaries[0]!.id,
        protectedValueKind: "trust",
        protectedValueDescription: "System instruction trust",
        protectedAssets: ["system_prompt"],
        relationships: {
          protectedComponentNodeIds: [promptId],
          relatedPromptNodeIds: systemPromptIds,
          relatedToolNodeIds: toolIds,
          relatedMemoryNodeIds: memoryIds,
          relatedRetrievalNodeIds: retrievalIds,
          relatedAgentIds: [],
          relatedMcpNodeIds: [],
          executionPathId: pathId,
          graphNodeIds: [promptId, ...llmIds],
          graphEdgeIds: edgesTouching(graph, promptId),
        },
        evidence: [
          evidenceFromGraph("prompt_node", "System prompt node in execution graph", 0.86, promptId),
        ],
        confidenceInput: { hasBoundary: Boolean(trustBoundary), hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
      })
    );
  }

  for (const promptId of developerPromptIds) {
    invariants.push(
      buildInvariant(graph, {
        invariantKey: `prompt:developer_prompt_integrity:${promptId.slice(0, 8)}`,
        title: "Developer prompt integrity",
        description: "Developer instructions must remain scoped and separable from end-user content.",
        category: "developer_prompt_integrity",
        boundaryId: trustBoundary?.id ?? graph.boundaries[0]!.id,
        protectedValueKind: "integrity",
        protectedValueDescription: "Developer instruction boundary",
        protectedAssets: ["developer_prompt"],
        relationships: {
          protectedComponentNodeIds: [promptId],
          relatedPromptNodeIds: [...developerPromptIds, ...systemPromptIds],
          relatedToolNodeIds: [],
          relatedMemoryNodeIds: [],
          relatedRetrievalNodeIds: [],
          relatedAgentIds: [],
          relatedMcpNodeIds: [],
          executionPathId: pathId,
          graphNodeIds: [promptId],
          graphEdgeIds: edgesTouching(graph, promptId),
        },
        evidence: [evidenceFromGraph("prompt_node", "Developer prompt node present", 0.82, promptId)],
        confidenceInput: { hasBoundary: Boolean(trustBoundary), hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
      })
    );
  }

  if (trustBoundary) {
    invariants.push(
      buildInvariant(graph, {
        invariantKey: "trust:boundary_preservation:primary",
        title: "Trust boundary preservation",
        description: "Crossing from user-controlled input to model inference must stay within defined trust boundaries.",
        category: "trust_boundary_preservation",
        boundaryId: trustBoundary.id,
        protectedValueKind: "trust",
        protectedValueDescription: "User-to-model trust boundary",
        protectedAssets: trustBoundary.protectedNodeIds,
        relationships: {
          protectedComponentNodeIds: trustBoundary.protectedNodeIds,
          relatedPromptNodeIds: [...userPromptIds, ...systemPromptIds],
          relatedToolNodeIds: toolIds,
          relatedMemoryNodeIds: memoryIds,
          relatedRetrievalNodeIds: retrievalIds,
          relatedAgentIds: graph.agents.map((a) => a.id),
          relatedMcpNodeIds: [...mcpClientIds, ...mcpServerIds],
          executionPathId: pathId,
          graphNodeIds: [...trustBoundary.protectedNodeIds, ...trustBoundary.crossingNodeIds],
          graphEdgeIds: graph.edges
            .filter(
              (e) =>
                trustBoundary.crossingNodeIds.includes(e.fromNodeId) ||
                trustBoundary.crossingNodeIds.includes(e.toNodeId)
            )
            .map((e) => e.id),
        },
        evidence: [
          evidenceFromGraph("trust_boundary", trustBoundary.label, 0.92, trustBoundary.id),
        ],
        confidenceInput: { hasBoundary: true, hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
      })
    );
  }

  if (toolBoundary && toolIds[0] && llmIds[0]) {
    invariants.push(
      buildInvariant(graph, {
        invariantKey: "tool:authorization:llm_invocation",
        title: "Tool authorization",
        description: "Only the authorized LLM path may invoke tools; tool calls must not bypass the tool boundary.",
        category: "tool_authorization",
        boundaryId: toolBoundary.id,
        protectedValueKind: "authorization",
        protectedValueDescription: "Tool invocation authorization",
        protectedAssets: ["tool", "llm"],
        relationships: {
          protectedComponentNodeIds: [toolIds[0]!, llmIds[0]!],
          relatedPromptNodeIds: systemPromptIds,
          relatedToolNodeIds: toolIds,
          relatedMemoryNodeIds: [],
          relatedRetrievalNodeIds: [],
          relatedAgentIds: graph.agents.map((a) => a.id),
          relatedMcpNodeIds: mcpClientIds,
          executionPathId: pathId,
          graphNodeIds: [...toolIds, ...llmIds, ...externalIds],
          graphEdgeIds: graph.edges.filter((e) => e.kind === "invokes" || e.kind === "calls").map((e) => e.id),
        },
        evidence: [
          evidenceFromGraph("trust_boundary", toolBoundary.label, 0.9, toolBoundary.id),
          evidenceFromGraph("graph_edge", "LLM invokes tool before external call", 0.85),
        ],
        confidenceInput: { hasBoundary: true, hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
        relatedKeys: ["tool:result_validation:primary"],
      })
    );

    invariants.push(
      buildInvariant(graph, {
        invariantKey: "tool:result_validation:primary",
        title: "Tool result validation",
        description: "Tool outputs returned to the model must be validated before influencing subsequent inference.",
        category: "tool_result_validation",
        boundaryId: toolBoundary.id,
        protectedValueKind: "authenticity",
        protectedValueDescription: "Tool result authenticity",
        protectedAssets: ["tool", "external_api"],
        relationships: {
          protectedComponentNodeIds: toolIds,
          relatedPromptNodeIds: [],
          relatedToolNodeIds: toolIds,
          relatedMemoryNodeIds: [],
          relatedRetrievalNodeIds: [],
          relatedAgentIds: [],
          relatedMcpNodeIds: [],
          executionPathId: pathId,
          graphNodeIds: [...toolIds, ...externalIds, ...llmIds],
          graphEdgeIds: graph.edges.filter((e) => e.kind === "routes" || e.kind === "calls").map((e) => e.id),
        },
        evidence: [evidenceFromGraph("execution_path", "Tool feedback routed to LLM", 0.8)],
        confidenceInput: { hasBoundary: true, hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
        dependencies: ["tool:authorization:llm_invocation"],
      })
    );

    invariants.push(
      buildInvariant(graph, {
        invariantKey: "external:api_trust:tool_backend",
        title: "External API trust",
        description: "External APIs reached via tools must stay outside the model trust zone until validated.",
        category: "external_api_trust",
        boundaryId: toolBoundary.id,
        protectedValueKind: "trust",
        protectedValueDescription: "External tool backend trust",
        protectedAssets: ["external_api"],
        relationships: {
          protectedComponentNodeIds: externalIds,
          relatedPromptNodeIds: [],
          relatedToolNodeIds: toolIds,
          relatedMemoryNodeIds: [],
          relatedRetrievalNodeIds: [],
          relatedAgentIds: [],
          relatedMcpNodeIds: [],
          executionPathId: pathId,
          graphNodeIds: [...externalIds, ...toolIds],
          graphEdgeIds: graph.edges.filter((e) => e.toNodeId === externalIds[0] || e.fromNodeId === externalIds[0]).map((e) => e.id),
        },
        evidence: [evidenceFromGraph("trust_boundary", "Tool boundary protects external API", 0.84, toolBoundary.id)],
        confidenceInput: { hasBoundary: true, hasExplicitEdge: externalIds.length > 0, evidenceMax: 0, fromAssumptionOnly: false },
      })
    );
  }

  if (memoryBoundary && memoryIds.length > 0) {
    invariants.push(
      buildInvariant(graph, {
        invariantKey: "memory:isolation:conversation_store",
        title: "Memory isolation",
        description: "Conversation memory writes must be scoped and must not leak across sessions or tenants.",
        category: "memory_isolation",
        boundaryId: memoryBoundary.id,
        protectedValueKind: "confidentiality",
        protectedValueDescription: "Conversation memory isolation",
        protectedAssets: ["memory"],
        relationships: {
          protectedComponentNodeIds: memoryIds,
          relatedPromptNodeIds: userPromptIds,
          relatedToolNodeIds: [],
          relatedMemoryNodeIds: memoryIds,
          relatedRetrievalNodeIds: [],
          relatedAgentIds: [],
          relatedMcpNodeIds: [],
          executionPathId: pathId,
          graphNodeIds: [...memoryIds, ...responseIds],
          graphEdgeIds: graph.edges.filter((e) => e.kind === "stores" || e.kind === "writes").map((e) => e.id),
        },
        evidence: [
          evidenceFromGraph("trust_boundary", memoryBoundary.label, 0.88, memoryBoundary.id),
          evidenceFromGraph("memory_node", "Memory node connected to response pipeline", 0.8),
        ],
        confidenceInput: { hasBoundary: true, hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
      })
    );

    invariants.push(
      buildInvariant(graph, {
        invariantKey: "memory:ownership:writer_path",
        title: "Memory ownership",
        description: "Only the validated assistant response path may persist conversation memory.",
        category: "memory_ownership",
        boundaryId: memoryBoundary.id,
        protectedValueKind: "authorization",
        protectedValueDescription: "Memory write ownership",
        protectedAssets: ["memory", "response"],
        relationships: {
          protectedComponentNodeIds: memoryIds,
          relatedPromptNodeIds: [],
          relatedToolNodeIds: toolIds,
          relatedMemoryNodeIds: memoryIds,
          relatedRetrievalNodeIds: [],
          relatedAgentIds: [],
          relatedMcpNodeIds: [],
          executionPathId: pathId,
          graphNodeIds: [...memoryIds, ...responseIds],
          graphEdgeIds: edgesTouching(graph, memoryIds[0]!),
        },
        evidence: [evidenceFromGraph("response_pipeline", "Response pipeline includes memory node", 0.82)],
        confidenceInput: { hasBoundary: true, hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
        relatedKeys: ["memory:isolation:conversation_store"],
      })
    );
  }

  if (retrievalBoundary && retrievalIds.length > 0) {
    invariants.push(
      buildInvariant(graph, {
        invariantKey: "retrieval:integrity:context_injection",
        title: "Retrieval integrity",
        description: "Retrieved context injected into the model must match trusted knowledge sources.",
        category: "retrieval_integrity",
        boundaryId: retrievalBoundary.id,
        protectedValueKind: "authenticity",
        protectedValueDescription: "RAG context integrity",
        protectedAssets: ["retrieved_context", "knowledge_base"],
        relationships: {
          protectedComponentNodeIds: retrievalIds,
          relatedPromptNodeIds: systemPromptIds,
          relatedToolNodeIds: [],
          relatedMemoryNodeIds: memoryIds,
          relatedRetrievalNodeIds: retrievalIds,
          relatedAgentIds: [],
          relatedMcpNodeIds: [],
          executionPathId: graph.paths.find((p) => p.purpose === "rag_path")?.id ?? pathId,
          graphNodeIds: [
            ...retrievalIds,
            ...nodeIdsByKind(graph, "vector_store"),
            ...nodeIdsByKind(graph, "knowledge_base"),
            ...llmIds,
          ],
          graphEdgeIds: graph.edges.filter((e) => e.kind === "retrieves").map((e) => e.id),
        },
        evidence: [
          evidenceFromGraph("retrieval_path", "Retrieval path connected to LLM", 0.86),
          evidenceFromGraph("trust_boundary", retrievalBoundary.label, 0.88, retrievalBoundary.id),
        ],
        confidenceInput: { hasBoundary: true, hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
      })
    );

    invariants.push(
      buildInvariant(graph, {
        invariantKey: "retrieval:authenticity:sources",
        title: "Retrieval authenticity",
        description: "Knowledge sources feeding retrieval must be authentic and tenant-appropriate.",
        category: "retrieval_authenticity",
        boundaryId: retrievalBoundary.id,
        protectedValueKind: "authenticity",
        protectedValueDescription: "Knowledge authenticity",
        protectedAssets: graph.knowledgeSources.map((k) => k.label),
        relationships: {
          protectedComponentNodeIds: retrievalIds,
          relatedPromptNodeIds: [],
          relatedToolNodeIds: [],
          relatedMemoryNodeIds: [],
          relatedRetrievalNodeIds: retrievalIds,
          relatedAgentIds: [],
          relatedMcpNodeIds: [],
          executionPathId: pathId,
          graphNodeIds: graph.knowledgeSources.map((k) => k.nodeId),
          graphEdgeIds: graph.edges.filter((e) => e.kind === "retrieves").map((e) => e.id),
        },
        evidence: graph.knowledgeSources.map((k) =>
          evidenceFromGraph("execution_graph", `Knowledge source ${k.label}`, 0.8, k.id)
        ),
        confidenceInput: {
          hasBoundary: true,
          hasExplicitEdge: graph.knowledgeSources.length > 0,
          evidenceMax: 0,
          fromAssumptionOnly: false,
        },
      })
    );
  }

  if (graph.embeddings.length > 0 || (graph.retrievals.length > 0 && nodeIdsByKind(graph, "vector_store").length > 0)) {
    const boundary = retrievalBoundary ?? trustBoundary ?? graph.boundaries[0]!;
    const embeddingNodes =
      graph.embeddings.length > 0
        ? graph.embeddings.map((e) => e.nodeId)
        : nodeIdsByKind(graph, "vector_store");
    invariants.push(
      buildInvariant(graph, {
        invariantKey: "embedding:integrity:pipeline",
        title: "Embedding integrity",
        description: "Embeddings used for retrieval must correspond to the intended source documents.",
        category: "embedding_integrity",
        boundaryId: boundary.id,
        protectedValueKind: "integrity",
        protectedValueDescription: "Embedding pipeline integrity",
        protectedAssets:
          graph.embeddings.length > 0
            ? graph.embeddings.map((e) => e.label)
            : ["vector_store"],
        relationships: {
          protectedComponentNodeIds: embeddingNodes,
          relatedPromptNodeIds: [],
          relatedToolNodeIds: [],
          relatedMemoryNodeIds: [],
          relatedRetrievalNodeIds: retrievalIds,
          relatedAgentIds: [],
          relatedMcpNodeIds: [],
          executionPathId: pathId,
          graphNodeIds: [...embeddingNodes, ...retrievalIds],
          graphEdgeIds: graph.edges.filter((e) => e.kind === "embeds" || e.kind === "retrieves").map((e) => e.id),
        },
        evidence:
          graph.embeddings.length > 0
            ? graph.embeddings.map((e) =>
                evidenceFromGraph("execution_graph", `Embedding node ${e.label}`, 0.78, e.id)
              )
            : [
                evidenceFromGraph("retrieval_path", "RAG pipeline includes vector store for embeddings", 0.76),
              ],
        confidenceInput: { hasBoundary: true, hasExplicitEdge: graph.embeddings.length > 0, evidenceMax: 0, fromAssumptionOnly: false },
      })
    );
  }

  if (moderationIds.length > 0 && guardrailIds.length > 0) {
    const boundary = trustBoundary ?? graph.boundaries[0]!;
    invariants.push(
      buildInvariant(graph, {
        invariantKey: "output:validation:moderation_guardrail",
        title: "Output validation",
        description: "Model outputs must pass moderation and guardrail checks before release to users.",
        category: "output_validation",
        boundaryId: boundary.id,
        protectedValueKind: "integrity",
        protectedValueDescription: "Safe output release",
        protectedAssets: ["moderation", "guardrail", "response"],
        relationships: {
          protectedComponentNodeIds: [...moderationIds, ...guardrailIds, ...responseIds],
          relatedPromptNodeIds: [],
          relatedToolNodeIds: [],
          relatedMemoryNodeIds: memoryIds,
          relatedRetrievalNodeIds: [],
          relatedAgentIds: [],
          relatedMcpNodeIds: [],
          executionPathId: pathId,
          graphNodeIds: [...llmIds, ...moderationIds, ...guardrailIds, ...responseIds],
          graphEdgeIds: graph.edges.filter((e) => e.kind === "filters" || e.kind === "validates").map((e) => e.id),
        },
        evidence: [
          evidenceFromGraph("response_pipeline", "Response pipeline includes moderation and guardrails", 0.87),
        ],
        confidenceInput: { hasBoundary: true, hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
        relatedKeys: ["output:filtering:stream"],
      })
    );

    invariants.push(
      buildInvariant(graph, {
        invariantKey: "moderation:integrity:filter_chain",
        title: "Moderation integrity",
        description: "Moderation filters must run on every assistant output path modeled in the graph.",
        category: "moderation_integrity",
        boundaryId: boundary.id,
        protectedValueKind: "trust",
        protectedValueDescription: "Moderation chain integrity",
        protectedAssets: ["moderation"],
        relationships: {
          protectedComponentNodeIds: moderationIds,
          relatedPromptNodeIds: [],
          relatedToolNodeIds: [],
          relatedMemoryNodeIds: [],
          relatedRetrievalNodeIds: [],
          relatedAgentIds: [],
          relatedMcpNodeIds: [],
          executionPathId: pathId,
          graphNodeIds: moderationIds,
          graphEdgeIds: edgesTouching(graph, moderationIds[0]!),
        },
        evidence: [evidenceFromGraph("response_pipeline", "Moderation node in graph", 0.85)],
        confidenceInput: { hasBoundary: true, hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
      })
    );

    invariants.push(
      buildInvariant(graph, {
        invariantKey: "guardrail:integrity:output_chain",
        title: "Guardrail integrity",
        description: "Guardrails must enforce policy after moderation and before streaming responses.",
        category: "guardrail_integrity",
        boundaryId: boundary.id,
        protectedValueKind: "trust",
        protectedValueDescription: "Guardrail enforcement",
        protectedAssets: ["guardrail"],
        relationships: {
          protectedComponentNodeIds: guardrailIds,
          relatedPromptNodeIds: [],
          relatedToolNodeIds: [],
          relatedMemoryNodeIds: [],
          relatedRetrievalNodeIds: [],
          relatedAgentIds: [],
          relatedMcpNodeIds: [],
          executionPathId: pathId,
          graphNodeIds: guardrailIds,
          graphEdgeIds: edgesTouching(graph, guardrailIds[0]!),
        },
        evidence: [evidenceFromGraph("response_pipeline", "Guardrail node in graph", 0.85)],
        confidenceInput: { hasBoundary: true, hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
      })
    );

    invariants.push(
      buildInvariant(graph, {
        invariantKey: "output:filtering:stream",
        title: "Output filtering",
        description: "Streamed responses must remain subject to the same filtering pipeline as buffered outputs.",
        category: "output_filtering",
        boundaryId: boundary.id,
        protectedValueKind: "integrity",
        protectedValueDescription: "Streaming output safety",
        protectedAssets: ["response"],
        relationships: {
          protectedComponentNodeIds: responseIds,
          relatedPromptNodeIds: [],
          relatedToolNodeIds: [],
          relatedMemoryNodeIds: memoryIds,
          relatedRetrievalNodeIds: [],
          relatedAgentIds: [],
          relatedMcpNodeIds: [],
          executionPathId: pathId,
          graphNodeIds: responseIds,
          graphEdgeIds: graph.edges.filter((e) => e.kind === "streams").map((e) => e.id),
        },
        evidence: [
          evidenceFromGraph("execution_graph", "Response output marked streamed in graph model", 0.8),
        ],
        confidenceInput: { hasBoundary: true, hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
      })
    );

    invariants.push(
      buildInvariant(graph, {
        invariantKey: "streaming:integrity:response_path",
        title: "Streaming integrity",
        description: "Streaming must not bypass moderation or guardrail nodes on the modeled path.",
        category: "streaming_integrity",
        boundaryId: boundary.id,
        protectedValueKind: "integrity",
        protectedValueDescription: "Streaming path integrity",
        protectedAssets: ["response"],
        relationships: {
          protectedComponentNodeIds: responseIds,
          relatedPromptNodeIds: [],
          relatedToolNodeIds: [],
          relatedMemoryNodeIds: [],
          relatedRetrievalNodeIds: [],
          relatedAgentIds: [],
          relatedMcpNodeIds: [],
          executionPathId: pathId,
          graphNodeIds: [...moderationIds, ...guardrailIds, ...responseIds],
          graphEdgeIds: graph.edges.filter((e) => e.kind === "streams").map((e) => e.id),
        },
        evidence: [evidenceFromGraph("graph_edge", "Stream edge follows validate/filter chain", 0.82)],
        confidenceInput: { hasBoundary: true, hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
      })
    );
  }

  if (privilegeBoundary && llmIds[0] && toolIds[0]) {
    invariants.push(
      buildInvariant(graph, {
        invariantKey: "privilege:separation:llm_tool",
        title: "Privilege separation",
        description: "LLM inference privileges must be separated from tool and external API privileges.",
        category: "privilege_separation",
        boundaryId: privilegeBoundary.id,
        protectedValueKind: "authorization",
        protectedValueDescription: "LLM vs tool privilege separation",
        protectedAssets: ["llm", "tool"],
        relationships: {
          protectedComponentNodeIds: [llmIds[0]!, toolIds[0]!],
          relatedPromptNodeIds: systemPromptIds,
          relatedToolNodeIds: toolIds,
          relatedMemoryNodeIds: [],
          relatedRetrievalNodeIds: [],
          relatedAgentIds: graph.agents.map((a) => a.id),
          relatedMcpNodeIds: mcpClientIds,
          executionPathId: pathId,
          graphNodeIds: [...llmIds, ...toolIds],
          graphEdgeIds: graph.edges.filter((e) => e.kind === "invokes").map((e) => e.id),
        },
        evidence: [evidenceFromGraph("trust_boundary", privilegeBoundary.label, 0.86, privilegeBoundary.id)],
        confidenceInput: { hasBoundary: true, hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
      })
    );
  }

  for (const agent of graph.agents) {
    const boundary = privilegeBoundary ?? trustBoundary ?? graph.boundaries[0]!;
    const category: AIInvariantCategory =
      agent.role === "orchestrator"
        ? "multi_agent_coordination"
        : graph.agents.length > 1
          ? "sub_agent_isolation"
          : "agent_isolation";
    invariants.push(
      buildInvariant(graph, {
        invariantKey: `agent:isolation:${agent.id.slice(0, 8)}`,
        title: `Agent isolation — ${agent.name}`,
        description: "Agent orchestration must not collapse trust boundaries between roles or tenants.",
        category,
        boundaryId: boundary.id,
        protectedValueKind: "authorization",
        protectedValueDescription: "Agent isolation",
        protectedAssets: [agent.name],
        relationships: {
          protectedComponentNodeIds: [agent.nodeId],
          relatedPromptNodeIds: systemPromptIds,
          relatedToolNodeIds: toolIds,
          relatedMemoryNodeIds: memoryIds,
          relatedRetrievalNodeIds: retrievalIds,
          relatedAgentIds: [agent.id],
          relatedMcpNodeIds: mcpClientIds,
          executionPathId: pathId,
          graphNodeIds: [agent.nodeId, ...llmIds],
          graphEdgeIds: graph.edges.filter((e) => e.kind === "delegates").map((e) => e.id),
        },
        evidence: [evidenceFromGraph("agent_graph", `Agent ${agent.name} (${agent.role})`, 0.84, agent.id)],
        confidenceInput: { hasBoundary: true, hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
      })
    );

    invariants.push(
      buildInvariant(graph, {
        invariantKey: `agent:delegation:${agent.id.slice(0, 8)}`,
        title: `Agent delegation — ${agent.name}`,
        description: "Delegated work must remain attributable and bounded to approved tools and models.",
        category: "agent_delegation",
        boundaryId: boundary.id,
        protectedValueKind: "authorization",
        protectedValueDescription: "Controlled agent delegation",
        protectedAssets: [agent.name],
        relationships: {
          protectedComponentNodeIds: [agent.nodeId],
          relatedPromptNodeIds: developerPromptIds,
          relatedToolNodeIds: toolIds,
          relatedMemoryNodeIds: memoryIds,
          relatedRetrievalNodeIds: retrievalIds,
          relatedAgentIds: graph.agents.map((a) => a.id),
          relatedMcpNodeIds: mcpClientIds,
          executionPathId: pathId,
          graphNodeIds: [agent.nodeId, ...llmIds],
          graphEdgeIds: graph.edges.filter((e) => e.fromNodeId === agent.nodeId || e.toNodeId === agent.nodeId).map((e) => e.id),
        },
        evidence: [evidenceFromGraph("agent_graph", "Delegation edges from agent to LLM/tools", 0.8)],
        confidenceInput: { hasBoundary: true, hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
      })
    );
  }

  if (graph.multiAgentGraphs.length > 0) {
    const boundary = trustBoundary ?? graph.boundaries[0]!;
    invariants.push(
      buildInvariant(graph, {
        invariantKey: "multi_agent:coordination:primary",
        title: "Multi-agent coordination",
        description: "Multi-agent graphs must preserve ordering and isolation between orchestrator and workers.",
        category: "multi_agent_coordination",
        boundaryId: boundary.id,
        protectedValueKind: "integrity",
        protectedValueDescription: "Multi-agent coordination integrity",
        protectedAssets: graph.agents.map((a) => a.name),
        relationships: {
          protectedComponentNodeIds: graph.agents.map((a) => a.nodeId),
          relatedPromptNodeIds: systemPromptIds,
          relatedToolNodeIds: toolIds,
          relatedMemoryNodeIds: memoryIds,
          relatedRetrievalNodeIds: retrievalIds,
          relatedAgentIds: graph.agents.map((a) => a.id),
          relatedMcpNodeIds: mcpClientIds,
          executionPathId: pathId,
          graphNodeIds: graph.agents.map((a) => a.nodeId),
          graphEdgeIds: [],
        },
        evidence: graph.multiAgentGraphs.map((g) =>
          evidenceFromGraph("agent_graph", `Multi-agent graph ${g.id}`, 0.83, g.id)
        ),
        confidenceInput: { hasBoundary: true, hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
      })
    );
  }

  if (mcpServerIds.length > 0) {
    const boundary = toolBoundary ?? trustBoundary ?? graph.boundaries[0]!;
    invariants.push(
      buildInvariant(graph, {
        invariantKey: "mcp:isolation:servers",
        title: "MCP isolation",
        description: "MCP servers must be isolated from direct user prompt influence and accessed via controlled clients.",
        category: "mcp_isolation",
        boundaryId: boundary.id,
        protectedValueKind: "authorization",
        protectedValueDescription: "MCP trust isolation",
        protectedAssets: ["mcp_server", "mcp_client"],
        relationships: {
          protectedComponentNodeIds: [...mcpServerIds, ...mcpClientIds],
          relatedPromptNodeIds: userPromptIds,
          relatedToolNodeIds: toolIds,
          relatedMemoryNodeIds: [],
          relatedRetrievalNodeIds: [],
          relatedAgentIds: graph.agents.map((a) => a.id),
          relatedMcpNodeIds: [...mcpServerIds, ...mcpClientIds],
          executionPathId: pathId,
          graphNodeIds: [...mcpServerIds, ...mcpClientIds, ...llmIds],
          graphEdgeIds: graph.edges.filter((e) => e.kind === "calls" || e.kind === "delegates").map((e) => e.id),
        },
        evidence: [
          evidenceFromGraph("mcp_node", "MCP server and client nodes present", 0.86),
        ],
        confidenceInput: { hasBoundary: true, hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
      })
    );
  }

  if (graph.toolInvocations.length > 0) {
    const boundary = toolBoundary ?? graph.boundaries[0]!;
    invariants.push(
      buildInvariant(graph, {
        invariantKey: "function_call:integrity:invocations",
        title: "Function call integrity",
        description: "Function and tool invocations must map to declared tool surfaces with traceable callers.",
        category: "function_call_integrity",
        boundaryId: boundary.id,
        protectedValueKind: "integrity",
        protectedValueDescription: "Function call contract integrity",
        protectedAssets: graph.tools.map((t) => t.name),
        relationships: {
          protectedComponentNodeIds: toolIds,
          relatedPromptNodeIds: [],
          relatedToolNodeIds: toolIds,
          relatedMemoryNodeIds: [],
          relatedRetrievalNodeIds: [],
          relatedAgentIds: graph.agents.map((a) => a.id),
          relatedMcpNodeIds: mcpClientIds,
          executionPathId: pathId,
          graphNodeIds: toolIds,
          graphEdgeIds: graph.edges.filter((e) => e.kind === "invokes").map((e) => e.id),
        },
        evidence: graph.toolInvocations.map((t) =>
          evidenceFromGraph("execution_graph", `Tool invocation ${t.id}`, 0.8, t.id)
        ),
        confidenceInput: { hasBoundary: true, hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
      })
    );
  }

  if (graph.conversations.length > 0) {
    const boundary = trustBoundary ?? graph.boundaries[0]!;
    invariants.push(
      buildInvariant(graph, {
        invariantKey: "conversation:isolation:primary",
        title: "Conversation isolation",
        description: "Conversation threads must isolate untrusted user content from privileged instructions.",
        category: "conversation_isolation",
        boundaryId: boundary.id,
        protectedValueKind: "confidentiality",
        protectedValueDescription: "Conversation boundary isolation",
        protectedAssets: ["conversation"],
        relationships: {
          protectedComponentNodeIds: userPromptIds,
          relatedPromptNodeIds: [...userPromptIds, ...systemPromptIds],
          relatedToolNodeIds: [],
          relatedMemoryNodeIds: memoryIds,
          relatedRetrievalNodeIds: [],
          relatedAgentIds: [],
          relatedMcpNodeIds: [],
          executionPathId: pathId,
          graphNodeIds: graph.conversations.flatMap((c) => c.steps.map((s) => s.nodeId)),
          graphEdgeIds: [],
        },
        evidence: [
          evidenceFromGraph("conversation_flow", graph.conversations[0]!.label, 0.85, graph.conversations[0]!.id),
        ],
        confidenceInput: { hasBoundary: true, hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
      })
    );

    invariants.push(
      buildInvariant(graph, {
        invariantKey: "conversation:continuity:persistence",
        title: "Conversation continuity",
        description: "Conversation persistence must remain consistent with memory writes on the modeled path.",
        category: "conversation_continuity",
        boundaryId: memoryBoundary?.id ?? boundary.id,
        protectedValueKind: "integrity",
        protectedValueDescription: "Conversation continuity",
        protectedAssets: ["conversation", "memory"],
        relationships: {
          protectedComponentNodeIds: memoryIds,
          relatedPromptNodeIds: userPromptIds,
          relatedToolNodeIds: [],
          relatedMemoryNodeIds: memoryIds,
          relatedRetrievalNodeIds: [],
          relatedAgentIds: [],
          relatedMcpNodeIds: [],
          executionPathId: pathId,
          graphNodeIds: [...memoryIds, ...responseIds],
          graphEdgeIds: graph.edges.filter((e) => e.kind === "stores").map((e) => e.id),
        },
        evidence: [evidenceFromGraph("conversation_flow", "Memory write step in conversation model", 0.8)],
        confidenceInput: { hasBoundary: Boolean(memoryBoundary), hasExplicitEdge: memoryIds.length > 0, evidenceMax: 0, fromAssumptionOnly: false },
      })
    );
  }

  if (retrievalIds.length > 0) {
    invariants.push(
      buildInvariant(graph, {
        invariantKey: "context:integrity:llm_input",
        title: "Context integrity",
        description: "All context entering the LLM must be composed from trusted prompts, retrieval, and tool results only.",
        category: "context_integrity",
        boundaryId: (retrievalBoundary ?? trustBoundary ?? graph.boundaries[0]!).id,
        protectedValueKind: "integrity",
        protectedValueDescription: "LLM input context integrity",
        protectedAssets: ["llm", "retrieved_context"],
        relationships: {
          protectedComponentNodeIds: llmIds,
          relatedPromptNodeIds: [...systemPromptIds, ...userPromptIds, ...developerPromptIds],
          relatedToolNodeIds: toolIds,
          relatedMemoryNodeIds: memoryIds,
          relatedRetrievalNodeIds: retrievalIds,
          relatedAgentIds: graph.agents.map((a) => a.id),
          relatedMcpNodeIds: mcpClientIds,
          executionPathId: pathId,
          graphNodeIds: [...llmIds, ...retrievalIds, ...toolIds],
          graphEdgeIds: graph.edges
            .filter((e) => llmIds.includes(e.toNodeId) || llmIds.includes(e.fromNodeId))
            .map((e) => e.id),
        },
        evidence: [evidenceFromGraph("execution_path", "Canonical path composes LLM inputs", 0.83)],
        confidenceInput: { hasBoundary: true, hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
      })
    );
  }

  if (userPromptIds.length > 0) {
    invariants.push(
      buildInvariant(graph, {
        invariantKey: "prompt:integrity:user_content",
        title: "Prompt integrity",
        description: "User prompts must be treated as untrusted input at the trust boundary.",
        category: "prompt_integrity",
        boundaryId: (trustBoundary ?? graph.boundaries[0]!).id,
        protectedValueKind: "trust",
        protectedValueDescription: "Untrusted user prompt handling",
        protectedAssets: ["user_prompt"],
        relationships: {
          protectedComponentNodeIds: userPromptIds,
          relatedPromptNodeIds: userPromptIds,
          relatedToolNodeIds: [],
          relatedMemoryNodeIds: [],
          relatedRetrievalNodeIds: [],
          relatedAgentIds: [],
          relatedMcpNodeIds: [],
          executionPathId: pathId,
          graphNodeIds: [...userPromptIds, ...nodeIdsByKind(graph, "user")],
          graphEdgeIds: edgesTouching(graph, userPromptIds[0]!),
        },
        evidence: [evidenceFromGraph("prompt_node", "User prompt node modeled as untrusted entry", 0.84)],
        confidenceInput: { hasBoundary: Boolean(trustBoundary), hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
      })
    );
  }

  invariants.push(
    buildInvariant(graph, {
      invariantKey: "instruction:integrity:composed_path",
      title: "Instruction integrity",
      description: "Composed instructions must remain traceable across system, developer, and user layers.",
      category: "instruction_integrity",
      boundaryId: (trustBoundary ?? graph.boundaries[0]!).id,
      protectedValueKind: "integrity",
      protectedValueDescription: "Instruction composition integrity",
      protectedAssets: ["system_prompt", "developer_prompt", "user_prompt"],
      relationships: {
        protectedComponentNodeIds: [...systemPromptIds, ...developerPromptIds, ...userPromptIds],
        relatedPromptNodeIds: [...systemPromptIds, ...developerPromptIds, ...userPromptIds],
        relatedToolNodeIds: [],
        relatedMemoryNodeIds: [],
        relatedRetrievalNodeIds: [],
        relatedAgentIds: [],
        relatedMcpNodeIds: [],
        executionPathId: pathId,
        graphNodeIds: [...systemPromptIds, ...developerPromptIds, ...userPromptIds],
        graphEdgeIds: graph.edges.filter((e) => e.kind === "routes").map((e) => e.id),
      },
      evidence: [evidenceFromGraph("execution_path", "Prompt routing edges in canonical path", 0.82)],
      confidenceInput: { hasBoundary: true, hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
    })
  );

  if (toolIds.length > 0) {
    invariants.push(
      buildInvariant(graph, {
        invariantKey: "tool:isolation:boundary",
        title: "Tool isolation",
        description: "Tools must not share privileges with user prompts or unvalidated retrieval context.",
        category: "tool_isolation",
        boundaryId: (toolBoundary ?? graph.boundaries[0]!).id,
        protectedValueKind: "authorization",
        protectedValueDescription: "Tool isolation from untrusted inputs",
        protectedAssets: ["tool"],
        relationships: {
          protectedComponentNodeIds: toolIds,
          relatedPromptNodeIds: userPromptIds,
          relatedToolNodeIds: toolIds,
          relatedMemoryNodeIds: [],
          relatedRetrievalNodeIds: retrievalIds,
          relatedAgentIds: graph.agents.map((a) => a.id),
          relatedMcpNodeIds: mcpClientIds,
          executionPathId: pathId,
          graphNodeIds: toolIds,
          graphEdgeIds: edgesTouching(graph, toolIds[0]!),
        },
        evidence: [evidenceFromGraph("tool_node", "Tool nodes separated by tool boundary", 0.83)],
        confidenceInput: { hasBoundary: Boolean(toolBoundary), hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
      })
    );

    invariants.push(
      buildInvariant(graph, {
        invariantKey: "tool:parameter_integrity:schema",
        title: "Tool parameter integrity",
        description: "Tool parameters must be validated against declared tool contracts before invocation.",
        category: "tool_parameter_integrity",
        boundaryId: (toolBoundary ?? graph.boundaries[0]!).id,
        protectedValueKind: "integrity",
        protectedValueDescription: "Tool parameter validation",
        protectedAssets: graph.tools.map((t) => t.name),
        relationships: {
          protectedComponentNodeIds: toolIds,
          relatedPromptNodeIds: developerPromptIds,
          relatedToolNodeIds: toolIds,
          relatedMemoryNodeIds: [],
          relatedRetrievalNodeIds: [],
          relatedAgentIds: [],
          relatedMcpNodeIds: [],
          executionPathId: pathId,
          graphNodeIds: toolIds,
          graphEdgeIds: graph.edges.filter((e) => e.kind === "invokes").map((e) => e.id),
        },
        evidence: graph.tools.map((t) => evidenceFromGraph("tool_node", `Tool surface ${t.name}`, 0.78, t.id)),
        confidenceInput: { hasBoundary: Boolean(toolBoundary), hasExplicitEdge: graph.tools.length > 0, evidenceMax: 0, fromAssumptionOnly: false },
        assumptions: ["Tool schemas are declared in application code (not verified in Slice 3)."],
      })
    );
  }

  if (graph.knowledgeSources.length > 0) {
    invariants.push(
      buildInvariant(graph, {
        invariantKey: "knowledge:trust:sources",
        title: "Knowledge trust",
        description: "Knowledge bases feeding retrieval must be trusted and scoped to the application tenant.",
        category: "knowledge_trust",
        boundaryId: (retrievalBoundary ?? trustBoundary ?? graph.boundaries[0]!).id,
        protectedValueKind: "authenticity",
        protectedValueDescription: "Knowledge base trust",
        protectedAssets: graph.knowledgeSources.map((k) => k.label),
        relationships: {
          protectedComponentNodeIds: graph.knowledgeSources.map((k) => k.nodeId),
          relatedPromptNodeIds: [],
          relatedToolNodeIds: [],
          relatedMemoryNodeIds: [],
          relatedRetrievalNodeIds: retrievalIds,
          relatedAgentIds: [],
          relatedMcpNodeIds: [],
          executionPathId: pathId,
          graphNodeIds: graph.knowledgeSources.map((k) => k.nodeId),
          graphEdgeIds: graph.edges.filter((e) => e.kind === "retrieves").map((e) => e.id),
        },
        evidence: graph.knowledgeSources.map((k) =>
          evidenceFromGraph("execution_graph", `Knowledge source ${k.label}`, 0.8, k.id)
        ),
        confidenceInput: { hasBoundary: true, hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: false },
      })
    );
  }

  if (memoryIds.length > 0) {
    invariants.push(
      buildInvariant(graph, {
        invariantKey: "memory:freshness:session_scope",
        title: "Memory freshness",
        description: "Memory used for inference must reflect the current session context unless explicitly archived.",
        category: "memory_freshness",
        boundaryId: (memoryBoundary ?? graph.boundaries[0]!).id,
        protectedValueKind: "integrity",
        protectedValueDescription: "Session memory freshness",
        protectedAssets: ["memory"],
        relationships: {
          protectedComponentNodeIds: memoryIds,
          relatedPromptNodeIds: userPromptIds,
          relatedToolNodeIds: [],
          relatedMemoryNodeIds: memoryIds,
          relatedRetrievalNodeIds: [],
          relatedAgentIds: [],
          relatedMcpNodeIds: [],
          executionPathId: pathId,
          graphNodeIds: memoryIds,
          graphEdgeIds: edgesTouching(graph, memoryIds[0]!),
        },
        evidence: [evidenceFromGraph("memory_node", "Memory node scoped in graph model", 0.75)],
        confidenceInput: { hasBoundary: Boolean(memoryBoundary), hasExplicitEdge: true, evidenceMax: 0, fromAssumptionOnly: true },
        assumptions: ["Session scope inferred from graph memory modeling."],
      })
    );
  }

  const filtered = dedupeInvariants(invariants.filter((i) => i.confidence !== "unsupported"));

  const groups: AIInvariantGroup[] = [];
  const categories = [...new Set(filtered.map((i) => i.category))].sort();
  for (const category of categories) {
    groups.push({
      id: stableAiId(`inv-group:${category}`),
      label: category.replace(/_/g, " "),
      category,
      boundaryId: filtered.find((i) => i.category === category)?.protectedTrustBoundaryId ?? null,
      invariantIds: filtered.filter((i) => i.category === category).map((i) => i.id),
    });
  }

  const collection: AIInvariantCollection = {
    id: stableAiId(`inv-collection:${graph.id}`),
    executionGraphId: graph.id,
    groups,
    invariants: filtered,
    validationViolations: [],
    extractedAt: new Date().toISOString(),
  };

  return validateAiInvariantCollection(collection, graph);
}

export const AIInvariantExtractor = {
  extract: extractAiTrustInvariants,
};
