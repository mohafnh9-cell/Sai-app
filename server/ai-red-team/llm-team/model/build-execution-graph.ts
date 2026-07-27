import type { AiDiscoveryInventory, DiscoveredAiComponent } from "../discovery/discovery.types";
import type {
  AIExecutionEdge,
  AIExecutionGraph,
  AIExecutionNode,
  AIExecutionNodeKind,
  AIPrompt,
} from "./execution-graph.types";
import { validateAiExecutionGraph } from "./graph-validation";
import { inferProviderFamily, type NormalizedAiProviderFamily } from "./normalize-provider";
import { stableAiId, stableNodeKey } from "./stable-id";

function nodeFromComponent(component: DiscoveredAiComponent): AIExecutionNodeKind {
  switch (component.kind) {
    case "llm_provider":
    case "inference_host":
      return "llm";
    case "ai_sdk":
      return "agent";
    case "agent_framework":
    case "orchestration":
      return "agent";
    case "embedding_model":
      return "embedding";
    case "vector_store":
      return "vector_store";
    case "knowledge_base":
      return "knowledge_base";
    case "mcp_server":
      return "mcp_server";
    case "mcp_client":
      return "mcp_client";
    case "tool_registry":
      return "tool";
    case "memory_store":
      return "memory";
    case "moderation":
      return "moderation";
    case "guardrail":
      return "guardrail";
    case "router":
      return "llm";
    default:
      return "llm";
  }
}

function makeNode(input: {
  kind: AIExecutionNodeKind;
  label: string;
  providerFamily: NormalizedAiProviderFamily | "generic";
  confidence: number;
  discoveredComponentId: string | null;
  tags: string[];
  evidence: AIExecutionNode["metadata"]["evidence"];
}): AIExecutionNode {
  const key = stableNodeKey(input.kind, input.label, input.discoveredComponentId ?? "canonical");
  return {
    id: stableAiId(`node:${key}`),
    kind: input.kind,
    label: input.label,
    providerFamily: input.providerFamily,
    confidence: input.confidence,
    discoveredComponentId: input.discoveredComponentId,
    metadata: { tags: input.tags, evidence: input.evidence },
  };
}

function edge(from: string, to: string, kind: AIExecutionEdge["kind"], label: string): AIExecutionEdge {
  return {
    id: stableAiId(`edge:${from}:${kind}:${to}`),
    fromNodeId: from,
    toNodeId: to,
    kind,
    label,
    traceRef: `${from}->${to}`,
  };
}

function mapEvidence(component: DiscoveredAiComponent): AIExecutionNode["metadata"]["evidence"] {
  return component.evidence.map((e) => ({
    id: e.id,
    source: e.source,
    detail: e.detail,
    confidence: e.confidence,
    discoveredComponentId: component.id,
  }));
}

export function buildAiExecutionGraph(inventory: AiDiscoveryInventory): AIExecutionGraph {
  const nodes: AIExecutionNode[] = [];
  const edges: AIExecutionEdge[] = [];
  const nodeById = new Map<string, AIExecutionNode>();

  const addNode = (n: AIExecutionNode) => {
    if (!nodeById.has(n.id)) {
      nodes.push(n);
      nodeById.set(n.id, n);
    }
    return n;
  };

  const signals = inventory.signals;
  const hasAi = signals.hasLlmProvider || signals.hasAiSdk || inventory.components.length > 0;

  let userNode: AIExecutionNode | null = null;
  let userPromptNode: AIExecutionNode | null = null;
  let systemPromptNode: AIExecutionNode | null = null;
  let developerPromptNode: AIExecutionNode | null = null;
  let llmNode: AIExecutionNode | null = null;
  let toolNode: AIExecutionNode | null = null;
  let externalApiNode: AIExecutionNode | null = null;
  let responseNode: AIExecutionNode | null = null;
  let memoryNode: AIExecutionNode | null = null;
  let retrievalContextNode: AIExecutionNode | null = null;
  let moderationNode: AIExecutionNode | null = null;
  let guardrailNode: AIExecutionNode | null = null;

  if (hasAi) {
    userNode = addNode(
      makeNode({
        kind: "user",
        label: "End user",
        providerFamily: "generic",
        confidence: 0.9,
        discoveredComponentId: null,
        tags: ["canonical"],
        evidence: [],
      })
    );
    userPromptNode = addNode(
      makeNode({
        kind: "user_prompt",
        label: "User prompt",
        providerFamily: "generic",
        confidence: 0.88,
        discoveredComponentId: null,
        tags: ["canonical", "prompt"],
        evidence: [],
      })
    );
    systemPromptNode = addNode(
      makeNode({
        kind: "system_prompt",
        label: "System prompt",
        providerFamily: "generic",
        confidence: 0.88,
        discoveredComponentId: null,
        tags: ["canonical", "prompt"],
        evidence: [],
      })
    );
    developerPromptNode = addNode(
      makeNode({
        kind: "developer_prompt",
        label: "Developer prompt",
        providerFamily: "generic",
        confidence: 0.75,
        discoveredComponentId: null,
        tags: ["canonical", "prompt"],
        evidence: [],
      })
    );
    llmNode = addNode(
      makeNode({
        kind: "llm",
        label: "Primary LLM inference",
        providerFamily: (signals.providerFamilies[0] as NormalizedAiProviderFamily) ?? "generic",
        confidence: 0.85,
        discoveredComponentId: null,
        tags: ["canonical", "inference"],
        evidence: [],
      })
    );
    toolNode = addNode(
      makeNode({
        kind: "tool",
        label: "Tool invocation surface",
        providerFamily: "generic",
        confidence: 0.8,
        discoveredComponentId: null,
        tags: ["canonical", "tool"],
        evidence: [],
      })
    );
    externalApiNode = addNode(
      makeNode({
        kind: "external_api",
        label: "External API (tool backend)",
        providerFamily: "generic",
        confidence: 0.78,
        discoveredComponentId: null,
        tags: ["canonical", "external"],
        evidence: [],
      })
    );
    responseNode = addNode(
      makeNode({
        kind: "response",
        label: "Model response",
        providerFamily: "generic",
        confidence: 0.88,
        discoveredComponentId: null,
        tags: ["canonical", "output"],
        evidence: [],
      })
    );
    memoryNode = addNode(
      makeNode({
        kind: "memory",
        label: "Conversation memory",
        providerFamily: "generic",
        confidence: signals.hasMemoryHint ? 0.82 : 0.55,
        discoveredComponentId: null,
        tags: ["canonical", "memory"],
        evidence: [],
      })
    );
    moderationNode = addNode(
      makeNode({
        kind: "moderation",
        label: "Moderation filter",
        providerFamily: "generic",
        confidence: 0.6,
        discoveredComponentId: null,
        tags: ["canonical", "safety"],
        evidence: [],
      })
    );
    guardrailNode = addNode(
      makeNode({
        kind: "guardrail",
        label: "Output guardrail",
        providerFamily: "generic",
        confidence: 0.6,
        discoveredComponentId: null,
        tags: ["canonical", "safety"],
        evidence: [],
      })
    );

    if (signals.hasRagHint) {
      retrievalContextNode = addNode(
        makeNode({
          kind: "retrieved_context",
          label: "Retrieved context",
          providerFamily: "generic",
          confidence: 0.8,
          discoveredComponentId: null,
          tags: ["canonical", "rag"],
          evidence: [],
        })
      );
    }

    edges.push(
      edge(userNode.id, userPromptNode.id, "creates", "User submits prompt"),
      edge(userPromptNode.id, systemPromptNode.id, "routes", "Prompt assembly"),
      edge(systemPromptNode.id, developerPromptNode.id, "routes", "Developer layer"),
      edge(developerPromptNode.id, llmNode.id, "executes", "LLM inference")
    );
    if (retrievalContextNode) {
      edges.push(edge(retrievalContextNode.id, llmNode.id, "retrieves", "RAG context injection"));
    }
    edges.push(
      edge(llmNode.id, toolNode.id, "invokes", "Tool call"),
      edge(toolNode.id, externalApiNode.id, "calls", "External tool API"),
      edge(externalApiNode.id, llmNode.id, "routes", "Tool result to LLM"),
      edge(llmNode.id, moderationNode.id, "filters", "Moderation"),
      edge(moderationNode.id, guardrailNode.id, "validates", "Guardrail"),
      edge(guardrailNode.id, responseNode.id, "streams", "Assistant response"),
      edge(responseNode.id, memoryNode.id, "stores", "Persist conversation memory")
    );
  }

  for (const component of inventory.components) {
    const kind = nodeFromComponent(component);
    const family = inferProviderFamily(component.providerFamily);
    const discoveredNode = addNode(
      makeNode({
        kind,
        label: component.label,
        providerFamily: family,
        confidence: component.confidence,
        discoveredComponentId: component.id,
        tags: [...component.tags, "discovered"],
        evidence: mapEvidence(component),
      })
    );

    if (llmNode && kind === "llm") {
      edges.push(edge(llmNode.id, discoveredNode.id, "uses", `Provider ${component.label}`));
    }
    if (llmNode && kind === "tool") {
      edges.push(edge(llmNode.id, discoveredNode.id, "invokes", `Tool registry ${component.label}`));
    }
    if (llmNode && kind === "mcp_server") {
      const client = addNode(
        makeNode({
          kind: "mcp_client",
          label: `MCP client for ${component.label}`,
          providerFamily: "mcp",
          confidence: component.confidence,
          discoveredComponentId: component.id,
          tags: ["mcp", "client"],
          evidence: mapEvidence(component),
        })
      );
      edges.push(edge(client.id, discoveredNode.id, "calls", "MCP server connection"));
      if (llmNode) edges.push(edge(llmNode.id, client.id, "delegates", "LLM delegates to MCP"));
    }
    if (retrievalContextNode && (kind === "vector_store" || kind === "knowledge_base")) {
      edges.push(edge(discoveredNode.id, retrievalContextNode.id, "retrieves", "Knowledge retrieval"));
    }
    if (memoryNode && kind === "memory") {
      edges.push(edge(responseNode!.id, discoveredNode.id, "writes", "Memory backend"));
    }
    if (kind === "agent" && llmNode) {
      edges.push(edge(discoveredNode.id, llmNode.id, "delegates", "Agent orchestrates LLM"));
    }
  }

  const prompts: AIPrompt[] = [];
  if (systemPromptNode) {
    prompts.push({
      id: stableAiId("prompt:system"),
      role: "system",
      label: systemPromptNode.label,
      nodeId: systemPromptNode.id,
      templateHint: null,
    });
  }
  if (developerPromptNode) {
    prompts.push({
      id: stableAiId("prompt:developer"),
      role: "developer",
      label: developerPromptNode.label,
      nodeId: developerPromptNode.id,
      templateHint: null,
    });
  }
  if (userPromptNode) {
    prompts.push({
      id: stableAiId("prompt:user"),
      role: "user",
      label: userPromptNode.label,
      nodeId: userPromptNode.id,
      templateHint: null,
    });
  }

  const canonicalPathIds = [
    userNode,
    userPromptNode,
    systemPromptNode,
    developerPromptNode,
    llmNode,
    toolNode,
    externalApiNode,
    llmNode,
    moderationNode,
    guardrailNode,
    responseNode,
    memoryNode,
  ]
    .filter(Boolean)
    .map((n) => n!.id);

  const paths = hasAi
    ? [
        {
          id: stableAiId("path:canonical"),
          nodeIds: canonicalPathIds,
          label: "Canonical LLM execution path",
          purpose: "canonical_happy_path" as const,
        },
      ]
    : [];

  if (signals.hasRagHint && retrievalContextNode && llmNode) {
    paths.push({
      id: stableAiId("path:rag"),
      nodeIds: [retrievalContextNode.id, llmNode.id],
      label: "RAG retrieval path",
      purpose: "rag_path",
    });
  }

  const boundaries = hasAi
    ? [
        {
          id: stableAiId("boundary:trust:user-llm"),
          kind: "trust" as const,
          label: "User to LLM trust boundary",
          protectedNodeIds: [llmNode!.id],
          crossingNodeIds: [userPromptNode!.id, systemPromptNode!.id],
        },
        {
          id: stableAiId("boundary:tool:llm-external"),
          kind: "tool" as const,
          label: "Tool execution boundary",
          protectedNodeIds: [externalApiNode!.id],
          crossingNodeIds: [toolNode!.id, llmNode!.id],
        },
        {
          id: stableAiId("boundary:memory"),
          kind: "memory" as const,
          label: "Memory persistence boundary",
          protectedNodeIds: [memoryNode!.id],
          crossingNodeIds: [responseNode!.id],
        },
        ...(signals.hasRagHint && retrievalContextNode
          ? [
              {
                id: stableAiId("boundary:retrieval"),
                kind: "retrieval" as const,
                label: "Retrieval data boundary",
                protectedNodeIds: [retrievalContextNode.id],
                crossingNodeIds: [llmNode!.id],
              },
            ]
          : []),
        {
          id: stableAiId("boundary:privilege:llm"),
          kind: "privilege" as const,
          label: "LLM privilege boundary",
          protectedNodeIds: [llmNode!.id],
          crossingNodeIds: [toolNode!.id],
        },
      ]
    : [];

  const conversation =
    hasAi && userNode && responseNode
      ? {
          id: stableAiId("conversation:primary"),
          label: "Primary AI conversation",
          entryNodeId: userNode.id,
          steps: [
            { id: stableAiId("step:1"), order: 1, kind: "user_message" as const, nodeId: userPromptNode!.id, label: "User message" },
            { id: stableAiId("step:2"), order: 2, kind: "system_context" as const, nodeId: systemPromptNode!.id, label: "System context" },
            ...(retrievalContextNode
              ? [{ id: stableAiId("step:rag"), order: 3, kind: "retrieval" as const, nodeId: retrievalContextNode.id, label: "Retrieve context" }]
              : []),
            { id: stableAiId("step:llm"), order: 4, kind: "llm_turn" as const, nodeId: llmNode!.id, label: "LLM turn" },
            { id: stableAiId("step:tool"), order: 5, kind: "tool_result" as const, nodeId: toolNode!.id, label: "Tool execution" },
            { id: stableAiId("step:resp"), order: 6, kind: "assistant_response" as const, nodeId: responseNode.id, label: "Assistant response" },
            { id: stableAiId("step:mem"), order: 7, kind: "memory_write" as const, nodeId: memoryNode!.id, label: "Memory write" },
          ],
        }
      : null;

  const agents = inventory.components
    .filter((c) => c.kind === "agent_framework" || c.kind === "ai_sdk")
    .map((c) => {
      const node = [...nodeById.values()].find((n) => n.discoveredComponentId === c.id);
      return {
        id: stableAiId(`agent:${c.id}`),
        name: c.label,
        role: c.tags.includes("multi_agent") ? ("orchestrator" as const) : ("worker" as const),
        nodeId: node?.id ?? stableAiId(`agent-node:${c.id}`),
        frameworkFamily: inferProviderFamily(c.providerFamily),
      };
    });

  const multiAgentGraphs =
    signals.hasMultiAgentHint && agents.length > 1
      ? [
          {
            id: stableAiId("multi-agent:primary"),
            agentIds: agents.map((a) => a.id),
            edges: agents.slice(1).map((a, i) => ({
              fromAgentId: agents[0]!.id,
              toAgentId: a.id,
              kind: "delegates" as const,
            })),
          },
        ]
      : [];

  nodes.sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind.localeCompare(b.kind)));
  edges.sort((a, b) => a.id.localeCompare(b.id));

  const draft: AIExecutionGraph = {
    id: stableAiId(`graph:${inventory.id}`),
    schemaVersion: 1,
    generatedAt: inventory.generatedAt,
    context: {
      id: stableAiId(`ctx:${inventory.id}`),
      projectId: inventory.projectId,
      organizationId: inventory.organizationId,
      inventoryId: inventory.id,
      providerFamilies: signals.providerFamilies.filter((f): f is NormalizedAiProviderFamily =>
        Boolean(f)
      ) as NormalizedAiProviderFamily[],
      tags: inventory.components.flatMap((c) => c.tags).filter((t, i, arr) => arr.indexOf(t) === i),
    },
    nodes,
    edges,
    paths,
    conversations: conversation ? [conversation] : [],
    prompts,
    tools: nodes
      .filter((n) => n.kind === "tool")
      .map((n) => ({
        id: stableAiId(`tool:${n.id}`),
        name: n.label,
        nodeId: n.id,
        description: "Discovered or canonical tool surface",
        trustLevel: n.discoveredComponentId ? "external" : "internal",
      })),
    toolInvocations:
      llmNode && toolNode
        ? [
            {
              id: stableAiId("tool-inv:primary"),
              toolId: stableAiId(`tool:${toolNode.id}`),
              callerNodeId: llmNode.id,
              targetNodeId: externalApiNode?.id ?? null,
            },
          ]
        : [],
    functionCalls: [],
    retrievals:
      retrievalContextNode && llmNode
        ? [
            {
              id: stableAiId("retrieval:primary"),
              label: "Primary retrieval",
              sourceIds: nodes
                .filter((n) => n.kind === "vector_store" || n.kind === "knowledge_base")
                .map((n) => stableAiId(`source:${n.id}`)),
              contextNodeId: retrievalContextNode.id,
              embeddingNodeId:
                nodes.find((n) => n.kind === "embedding")?.id ?? null,
            },
          ]
        : [],
    retrievalSources: nodes
      .filter((n) => n.kind === "vector_store" || n.kind === "knowledge_base")
      .map((n) => ({
        id: stableAiId(`source:${n.id}`),
        label: n.label,
        vectorStoreNodeId: n.kind === "vector_store" ? n.id : null,
        knowledgeNodeId: n.kind === "knowledge_base" ? n.id : null,
      })),
    vectorStores: nodes
      .filter((n) => n.kind === "vector_store")
      .map((n) => ({
        id: stableAiId(`vs:${n.id}`),
        label: n.label,
        nodeId: n.id,
        providerFamily: n.providerFamily,
      })),
    embeddings: nodes
      .filter((n) => n.kind === "embedding")
      .map((n) => ({
        id: stableAiId(`emb:${n.id}`),
        label: n.label,
        nodeId: n.id,
        providerFamily: n.providerFamily,
      })),
    memories: nodes
      .filter((n) => n.kind === "memory")
      .map((n) => ({
        id: stableAiId(`mem:${n.id}`),
        label: n.label,
        nodeId: n.id,
        scope: n.discoveredComponentId ? "user" : "session",
      })),
    knowledgeSources: nodes
      .filter((n) => n.kind === "knowledge_base")
      .map((n) => ({
        id: stableAiId(`kb:${n.id}`),
        label: n.label,
        nodeId: n.id,
        sourceType: "documents" as const,
      })),
    agents,
    multiAgentGraphs,
    workflows: paths.map((p) => ({
      id: stableAiId(`workflow:${p.id}`),
      label: p.label,
      pathId: p.id,
      agentId: agents[0]?.id ?? null,
    })),
    boundaries,
    responsePipelines:
      llmNode && responseNode
        ? [
            {
              id: stableAiId("pipeline:response"),
              llmNodeId: llmNode.id,
              moderationNodeId: moderationNode?.id ?? null,
              guardrailNodeId: guardrailNode?.id ?? null,
              responseNodeId: responseNode.id,
              memoryNodeId: memoryNode?.id ?? null,
            },
          ]
        : [],
    outputs: responseNode
      ? [{ id: stableAiId("output:primary"), responseNodeId: responseNode.id, label: "Primary output", streamed: true }]
      : [],
    validationIssues: [],
  };

  draft.validationIssues = validateAiExecutionGraph(draft);
  return draft;
}

export const AiExecutionGraphBuilder = {
  build: buildAiExecutionGraph,
};
