import type { CoreExecutionGraph, CoreGraphStatistics, CoreGraphValidationIssue } from "./graph.types";

export function computeGraphStatistics<
  N extends string = string,
  E extends string = string,
>(graph: CoreExecutionGraph<N, E>): CoreGraphStatistics {
  const nodes = graph.nodes;
  const avg =
    nodes.length === 0
      ? 0
      : nodes.reduce((sum, n) => sum + n.confidence, 0) / nodes.length;
  return {
    nodeCount: nodes.length,
    edgeCount: graph.edges.length,
    pathCount: graph.paths.length,
    averageNodeConfidence: avg,
  };
}

export function validateGraphStructure<
  N extends string = string,
  E extends string = string,
>(graph: CoreExecutionGraph<N, E>): CoreGraphValidationIssue[] {
  const issues: CoreGraphValidationIssue[] = [];
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.fromNodeId)) {
      issues.push({
        code: "missing_from_node",
        message: `Edge ${edge.id} references missing fromNode ${edge.fromNodeId}`,
        edgeId: edge.id,
      });
    }
    if (!nodeIds.has(edge.toNodeId)) {
      issues.push({
        code: "missing_to_node",
        message: `Edge ${edge.id} references missing toNode ${edge.toNodeId}`,
        edgeId: edge.id,
      });
    }
  }
  for (const path of graph.paths) {
    for (const nodeId of path.nodeIds) {
      if (!nodeIds.has(nodeId)) {
        issues.push({
          code: "missing_path_node",
          message: `Path ${path.id} references missing node ${nodeId}`,
        });
      }
    }
  }
  return issues;
}

/** Declarative graph builder contract — implementations live in domain teams. */
export type CoreGraphBuilderContract<TInput, TGraph extends CoreExecutionGraph> = {
  build(input: TInput): TGraph;
};

export type CoreGraphTraversal = {
  walkNodes: <N extends string, E extends string>(
    graph: CoreExecutionGraph<N, E>,
    startNodeId: string
  ) => string[];
};

export function walkGraphNodes<
  N extends string = string,
  E extends string = string,
>(graph: CoreExecutionGraph<N, E>, startNodeId: string): string[] {
  const visited = new Set<string>();
  const queue = [startNodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const edge of graph.edges) {
      if (edge.fromNodeId === current) queue.push(edge.toNodeId);
      if (edge.toNodeId === current) queue.push(edge.fromNodeId);
    }
  }
  return [...visited];
}
