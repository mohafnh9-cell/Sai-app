import type { AIExecutionGraph } from "../model/execution-graph.types";
import type {
  AIInvariant,
  AIInvariantCollection,
  AIInvariantViolation,
} from "./invariant.types";
import { invariantPassesMinimumBar } from "./invariant-confidence";
import { nodeIdsByKind } from "./invariant-graph-helpers";
import { stableAiId } from "../model/stable-id";

function validateSingleInvariant(invariant: AIInvariant): AIInvariantViolation[] {
  const violations: AIInvariantViolation[] = [];

  if (!invariant.protectedTrustBoundaryId) {
    violations.push({
      id: stableAiId(`viol:${invariant.id}:boundary`),
      invariantId: invariant.id,
      code: "missing_trust_boundary_ref",
      message: "Invariant must protect at least one trust boundary.",
    });
  }

  if (invariant.relationships.graphNodeIds.length === 0) {
    violations.push({
      id: stableAiId(`viol:${invariant.id}:nodes`),
      invariantId: invariant.id,
      code: "missing_graph_nodes",
      message: "Invariant must reference execution graph nodes.",
    });
  }

  if (invariant.evidence.length === 0) {
    violations.push({
      id: stableAiId(`viol:${invariant.id}:evidence`),
      invariantId: invariant.id,
      code: "missing_evidence",
      message: "Invariant has no supporting evidence.",
    });
  }

  if (!invariantPassesMinimumBar(invariant)) {
    violations.push({
      id: stableAiId(`viol:${invariant.id}:confidence`),
      invariantId: invariant.id,
      code: "unsupported_confidence",
      message: "Invariant confidence is unsupported or below evidence threshold.",
    });
  }

  return violations;
}

function validateGraphAgainstInvariants(
  graph: AIExecutionGraph,
  invariants: AIInvariant[]
): AIInvariantViolation[] {
  const violations: AIInvariantViolation[] = [];
  const boundaryIds = new Set(graph.boundaries.map((b) => b.id));
  const nodeIds = new Set(graph.nodes.map((n) => n.id));

  const hasSystem = nodeIdsByKind(graph, "system_prompt").length > 0;
  const hasUser = nodeIdsByKind(graph, "user_prompt").length > 0;
  const hasLlm = nodeIdsByKind(graph, "llm").length > 0;

  if (hasSystem && hasUser && hasLlm) {
    const hasHierarchy = invariants.some(
      (i) =>
        i.category === "instruction_priority" ||
        i.category === "system_prompt_integrity" ||
        i.category === "instruction_integrity"
    );
    if (!hasHierarchy) {
      violations.push({
        id: stableAiId(`viol:graph:prompt_hierarchy:${graph.id}`),
        invariantId: null,
        code: "missing_prompt_hierarchy",
        message: "Graph models prompts and LLM but no prompt hierarchy invariants were extracted.",
      });
    }
  }

  const hasModeration = nodeIdsByKind(graph, "moderation").length > 0;
  const hasGuardrail = nodeIdsByKind(graph, "guardrail").length > 0;
  const hasResponse = nodeIdsByKind(graph, "response").length > 0;
  if (hasResponse && hasLlm && (!hasModeration || !hasGuardrail)) {
    const hasGuardrailInv = invariants.some(
      (i) => i.category === "guardrail_integrity" || i.category === "moderation_integrity"
    );
    if (!hasGuardrailInv) {
      violations.push({
        id: stableAiId(`viol:graph:guardrails:${graph.id}`),
        invariantId: null,
        code: "missing_guardrails",
        message: "Response pipeline lacks modeled guardrail or moderation invariants.",
      });
    }
  }

  const memoryIds = nodeIdsByKind(graph, "memory");
  if (memoryIds.length > 0) {
    const storeEdges = graph.edges.filter(
      (e) => (e.kind === "stores" || e.kind === "writes") && memoryIds.includes(e.toNodeId)
    );
    const hasMemoryInv = invariants.some(
      (i) => i.category === "memory_isolation" || i.category === "memory_ownership"
    );
    if (storeEdges.length === 0 && !hasMemoryInv) {
      violations.push({
        id: stableAiId(`viol:graph:orphan_memory:${graph.id}`),
        invariantId: null,
        code: "orphan_memory",
        message: "Memory nodes exist without store edges or protective invariants.",
      });
    }
  }

  const retrievalIds = nodeIdsByKind(graph, "retrieved_context");
  if (retrievalIds.length > 0) {
    const retrievalBoundary = graph.boundaries.find((b) => b.kind === "retrieval");
    const hasRetrievalInv = invariants.some(
      (i) => i.category === "retrieval_integrity" || i.category === "retrieval_authenticity"
    );
    if (!retrievalBoundary && !hasRetrievalInv) {
      violations.push({
        id: stableAiId(`viol:graph:unprotected_retrieval:${graph.id}`),
        invariantId: null,
        code: "unprotected_retrieval",
        message: "Retrieval context is modeled without retrieval boundary or invariants.",
      });
    }
  }

  const toolIds = nodeIdsByKind(graph, "tool");
  const llmIds = nodeIdsByKind(graph, "llm");
  if (toolIds.length > 0 && llmIds.length > 0) {
    const invokeEdges = graph.edges.filter(
      (e) => e.kind === "invokes" && llmIds.includes(e.fromNodeId) && toolIds.includes(e.toNodeId)
    );
    if (invokeEdges.length === 0) {
      violations.push({
        id: stableAiId(`viol:graph:dangling_tools:${graph.id}`),
        invariantId: null,
        code: "dangling_tool_permissions",
        message: "Tools present without LLM invoke edges — tool authorization chain may be broken.",
      });
    }
  }

  if (graph.agents.length > 1) {
    const delegateEdges = graph.edges.filter((e) => e.kind === "delegates");
    const hasDelegationInv = invariants.some((i) => i.category === "agent_delegation");
    if (delegateEdges.length === 0 && !hasDelegationInv) {
      violations.push({
        id: stableAiId(`viol:graph:broken_delegation:${graph.id}`),
        invariantId: null,
        code: "broken_delegation",
        message: "Multiple agents modeled without delegation edges or delegation invariants.",
      });
    }
    const hasAgentIso = invariants.some(
      (i) => i.category === "agent_isolation" || i.category === "sub_agent_isolation"
    );
    if (!hasAgentIso) {
      violations.push({
        id: stableAiId(`viol:graph:broken_agent_isolation:${graph.id}`),
        invariantId: null,
        code: "broken_agent_isolation",
        message: "Multi-agent graph lacks agent isolation invariants.",
      });
    }
  }

  const mcpServers = nodeIdsByKind(graph, "mcp_server");
  if (mcpServers.length > 0) {
    const hasMcpInv = invariants.some((i) => i.category === "mcp_isolation");
    if (!hasMcpInv) {
      violations.push({
        id: stableAiId(`viol:graph:broken_mcp:${graph.id}`),
        invariantId: null,
        code: "broken_mcp_isolation",
        message: "MCP servers modeled without MCP isolation invariants.",
      });
    }
  }

  const privilegeBoundary = graph.boundaries.find((b) => b.kind === "privilege");
  if (toolIds.length > 0 && llmIds.length > 0 && !privilegeBoundary) {
    const hasPrivInv = invariants.some((i) => i.category === "privilege_separation");
    if (!hasPrivInv) {
      violations.push({
        id: stableAiId(`viol:graph:privilege_chain:${graph.id}`),
        invariantId: null,
        code: "broken_privilege_chain",
        message: "LLM and tools co-exist without privilege boundary or separation invariant.",
      });
    }
  }

  for (const inv of invariants) {
    if (inv.protectedTrustBoundaryId && !boundaryIds.has(inv.protectedTrustBoundaryId)) {
      violations.push({
        id: stableAiId(`viol:${inv.id}:bad_boundary`),
        invariantId: inv.id,
        code: "missing_trust_boundary_ref",
        message: "Invariant references a boundary id not present in the execution graph.",
      });
    }
    for (const nid of inv.relationships.graphNodeIds) {
      if (!nodeIds.has(nid)) {
        violations.push({
          id: stableAiId(`viol:${inv.id}:bad_node:${nid.slice(0, 8)}`),
          invariantId: inv.id,
          code: "missing_graph_nodes",
          message: `Invariant references unknown graph node ${nid}.`,
        });
      }
    }
  }

  const trustBoundary = graph.boundaries.find((b) => b.kind === "trust");
  if (graph.nodes.length > 0 && !trustBoundary) {
    violations.push({
      id: stableAiId(`viol:graph:missing_trust_boundary:${graph.id}`),
      invariantId: null,
      code: "missing_trust_boundary_ref",
      message: "Execution graph has nodes but no trust boundary.",
    });
  }

  return violations;
}

export function validateAiInvariants(invariants: AIInvariant[]): AIInvariantViolation[] {
  return invariants.flatMap(validateSingleInvariant);
}

export function validateAiInvariantCollection(
  collection: AIInvariantCollection,
  graph?: AIExecutionGraph
): AIInvariantCollection {
  const perInvariant = validateAiInvariants(collection.invariants);
  const graphLevel = graph ? validateGraphAgainstInvariants(graph, collection.invariants) : [];
  return {
    ...collection,
    validationViolations: [...collection.validationViolations, ...perInvariant, ...graphLevel],
  };
}

export const AIInvariantValidator = {
  validateInvariants: validateAiInvariants,
  validateCollection: validateAiInvariantCollection,
};
