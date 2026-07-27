import type { AIAttackCase } from "../attacks/attack.types";
import type { AIInvariant } from "../invariants/invariant.types";
import type { AIExecutionGraph } from "../model/execution-graph.types";
import type { AIExecutionResult } from "../runtime/runtime.types";
import type {
  AttackCapability,
  AttackPreconditions,
  AIFindingConfidence,
  AIFindingSeverity,
} from "./finding.types";
import { detectGraphArchitectures } from "../specialists/specialist-selection";
import { stableAiId } from "../model/stable-id";

const CAPABILITY_MAP: Record<string, AttackCapability> = {
  anonymous_user: "anonymous_user",
  authenticated_user: "authenticated_user",
  workspace_member: "workspace_member",
  organization_admin: "organization_admin",
  malicious_document_author: "document_author",
  malicious_rag_source: "knowledge_base_editor",
  compromised_tool: "compromised_tool",
  compromised_mcp_server: "compromised_mcp_server",
  compromised_agent: "agent_owner",
  external_api_manipulator: "external_api_controller",
  insider: "insider",
};

export function mapAttackerCapability(attack: AIAttackCase | null): AttackCapability {
  if (!attack) return "authenticated_user";
  return CAPABILITY_MAP[attack.attackerCapability] ?? "authenticated_user";
}

export function inferModelProfile(graph: AIExecutionGraph): string {
  const arch = detectGraphArchitectures(graph);
  if (arch.includes("agents") && arch.includes("rag")) return "hybrid_ai_system";
  if (arch.includes("agents")) return "multi_agent_system";
  if (arch.includes("rag")) return "rag_heavy_assistant";
  if (arch.includes("tools")) return "tool_first_agent";
  if (graph.nodes.some((n) => n.kind === "developer_prompt")) return "coding_assistant";
  return "customer_support_assistant";
}

export function buildAttackPreconditions(input: {
  graph: AIExecutionGraph;
  invariant: AIInvariant;
  attack: AIAttackCase | null;
  execution: AIExecutionResult;
}): AttackPreconditions {
  const boundary = input.graph.boundaries.find((b) => b.id === input.invariant.protectedTrustBoundaryId);
  const pathId = input.attack?.sequence.executionPathId ?? input.invariant.relationships.executionPathId;

  const promptLayers: string[] = [];
  if (input.graph.nodes.some((n) => n.kind === "system_prompt")) promptLayers.push("system");
  if (input.graph.nodes.some((n) => n.kind === "developer_prompt")) promptLayers.push("developer");
  if (input.graph.nodes.some((n) => n.kind === "user_prompt")) promptLayers.push("user");

  const architectures = detectGraphArchitectures(input.graph).map((a) => ({
    architecture: a,
    required: true,
  }));

  return {
    requiredAttackerCapability: mapAttackerCapability(input.attack),
    requiredTrustBoundaries: boundary
      ? [{ boundaryId: boundary.id, boundaryKind: boundary.kind, required: true }]
      : [],
    requiredComponents: input.invariant.protectedAssets,
    requiredProviders: input.graph.context.providerFamilies,
    requiredModelProfile: inferModelProfile(input.graph),
    requiredArchitecture: architectures,
    requiredPromptLayers: promptLayers,
    requiredMemoryState: input.graph.nodes.some((n) => n.kind === "memory")
      ? [{ layer: "memory", description: "Writable session memory on modeled path", required: true }]
      : [],
    requiredConversationState: input.graph.conversations.length
      ? [{ layer: "conversation", description: "Active conversation thread", required: true }]
      : [],
    requiredRetrievalState: input.graph.nodes.some((n) => n.kind === "retrieved_context")
      ? [{ layer: "retrieval", description: "Retrieval injects context into LLM", required: true }]
      : [],
    requiredToolPermissions: input.graph.tools.map((t) => t.name),
    requiredFunctionPermissions: input.graph.tools.map((t) => `invoke:${t.name}`),
    requiredMcpConfiguration: input.graph.nodes.some((n) => n.kind === "mcp_server")
      ? ["mcp_client_to_server_bridge"]
      : [],
    requiredAgentTopology: input.graph.agents.map((a) => `${a.role}:${a.name}`),
    requiredExternalDependencies: input.graph.nodes.some((n) => n.kind === "external_api")
      ? ["external_api_reachable_via_tool"]
      : [],
    requiredEnvironment: [
      { id: stableAiId("pre:env:synthetic"), label: "Safe synthetic runtime validation", required: true },
    ],
    requiredFeatureFlags: [],
    requiredSecrets: [],
    requiredConfiguration: ["ai_execution_graph_modeled"],
    requiredRuntimeMode: input.execution.executionMode,
    requiredDataFlow: input.attack?.sequence.steps.map((s) => s.label) ?? [],
    requiredExecutionPathId: pathId,
    requiredGraphNodeIds: [
      ...new Set([
        ...input.invariant.relationships.graphNodeIds,
        ...input.execution.executedSteps.map((s) => s.nodeId).filter((x): x is string => Boolean(x)),
      ]),
    ],
    requiredGraphEdgeIds: input.invariant.relationships.graphEdgeIds,
    unsupportedConditions: input.execution.status === "blocked" ? ["production_live_execution"] : [],
    blockingConditions: [],
    optionalConditions: input.attack?.assumptions.map((a) => a.statement) ?? [],
  };
}

export function findingConfidenceFromExecution(execution: AIExecutionResult): AIFindingConfidence {
  if (execution.confidence === "inconclusive" || execution.confidence === "blocked") {
    return "possible";
  }
  return execution.confidence as AIFindingConfidence;
}

export function findingSeverity(input: {
  invariant: AIInvariant;
  attack: AIAttackCase | null;
  execution: AIExecutionResult;
  confidence: AIFindingConfidence;
  capability: AttackCapability;
}): AIFindingSeverity {
  if (input.confidence === "possible") return "low";
  if (input.invariant.protectedValueKind === "confidentiality") {
    return input.confidence === "confirmed" ? "critical" : "high";
  }
  if (input.invariant.protectedValueKind === "authorization") {
    return input.capability === "anonymous_user" ? "critical" : "high";
  }
  if (input.attack?.category.includes("injection") || input.attack?.category.includes("poisoning")) {
    return input.confidence === "confirmed" ? "high" : "medium";
  }
  if (input.execution.violatedInvariantId) {
    return input.confidence === "confirmed" ? "high" : "medium";
  }
  return "informational";
}

export const AttackPreconditionsBuilder = {
  build: buildAttackPreconditions,
};
