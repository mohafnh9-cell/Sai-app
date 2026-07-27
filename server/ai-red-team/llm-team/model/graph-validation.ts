import type { AIExecutionGraph, AIExecutionGraphValidationIssue } from "./execution-graph.types";

function buildAdjacency(graph: AIExecutionGraph): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    adj.set(node.id, new Set());
  }
  for (const edge of graph.edges) {
    adj.get(edge.fromNodeId)?.add(edge.toNodeId);
    adj.get(edge.toNodeId)?.add(edge.fromNodeId);
  }
  return adj;
}

function detectCycle(graph: AIExecutionGraph): boolean {
  const cycleKinds = new Set<AIExecutionGraph["edges"][0]["kind"]>([
    "invokes",
    "calls",
    "delegates",
    "executes",
  ]);
  const adj = new Map<string, string[]>();
  for (const node of graph.nodes) adj.set(node.id, []);
  for (const edge of graph.edges) {
    if (!cycleKinds.has(edge.kind)) continue;
    adj.get(edge.fromNodeId)?.push(edge.toNodeId);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const dfs = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of adj.get(id) ?? []) {
      if (dfs(next)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  for (const node of graph.nodes) {
    if (dfs(node.id)) return true;
  }
  return false;
}

export function validateAiExecutionGraph(graph: AIExecutionGraph): AIExecutionGraphValidationIssue[] {
  const issues: AIExecutionGraphValidationIssue[] = [];
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const keyCounts = new Map<string, number>();

  for (const node of graph.nodes) {
    const key = `${node.kind}:${node.label}:${node.discoveredComponentId ?? ""}`;
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of keyCounts) {
    if (count > 1) {
      issues.push({
        code: "duplicate_node",
        message: `Duplicate normalized node key: ${key}`,
      });
    }
  }

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) {
      issues.push({
        code: "broken_relationship",
        message: `Edge references missing node: ${edge.traceRef}`,
        edgeId: edge.id,
      });
    }
  }

  if (graph.nodes.length > 1) {
    const adj = buildAdjacency(graph);
    for (const node of graph.nodes) {
      const degree = adj.get(node.id)?.size ?? 0;
      if (degree === 0 && node.kind !== "user") {
        issues.push({
          code: "disconnected_node",
          message: `Node "${node.label}" (${node.kind}) is disconnected.`,
          nodeId: node.id,
        });
      }
    }
  }

  if (detectCycle(graph)) {
    issues.push({
      code: "cycle_detected",
      message: "Execution graph contains a directed cycle.",
    });
  }

  const llmIds = new Set(graph.nodes.filter((n) => n.kind === "llm").map((n) => n.id));
  for (const tool of graph.tools) {
    const connected = graph.edges.some(
      (e) =>
        (e.fromNodeId === tool.nodeId || e.toNodeId === tool.nodeId) &&
        (llmIds.has(e.fromNodeId) || llmIds.has(e.toNodeId))
    );
    if (!connected && graph.nodes.length > 0) {
      issues.push({
        code: "dangling_tool",
        message: `Tool "${tool.name}" is not connected to an LLM node.`,
        nodeId: tool.nodeId,
      });
    }
  }

  for (const prompt of graph.prompts) {
    const connected = graph.edges.some(
      (e) => e.fromNodeId === prompt.nodeId || e.toNodeId === prompt.nodeId
    );
    if (!connected) {
      issues.push({
        code: "dangling_prompt",
        message: `Prompt "${prompt.label}" is not part of an execution chain.`,
        nodeId: prompt.nodeId,
      });
    }
  }

  if (graph.nodes.some((n) => n.kind === "llm") && !graph.boundaries.some((b) => b.kind === "trust")) {
    issues.push({
      code: "missing_trust_boundary",
      message: "LLM present but no trust boundary modeled.",
    });
  }

  for (const memory of graph.memories) {
    const connected = graph.edges.some(
      (e) => e.fromNodeId === memory.nodeId || e.toNodeId === memory.nodeId
    );
    if (!connected) {
      issues.push({
        code: "orphan_memory",
        message: `Memory "${memory.label}" has no read/write edges.`,
        nodeId: memory.nodeId,
      });
    }
  }

  for (const retrieval of graph.retrievals) {
    const connected = graph.edges.some(
      (e) => e.fromNodeId === retrieval.contextNodeId || e.toNodeId === retrieval.contextNodeId
    );
    if (!connected) {
      issues.push({
        code: "orphan_retrieval",
        message: `Retrieval "${retrieval.label}" is not connected to the graph.`,
        nodeId: retrieval.contextNodeId,
      });
    }
  }

  if (graph.paths.length === 0 && graph.nodes.length > 0) {
    issues.push({
      code: "invalid_execution_chain",
      message: "Graph has nodes but no execution paths.",
    });
  }

  return issues;
}

export const AiExecutionGraphValidator = {
  validate: validateAiExecutionGraph,
};
