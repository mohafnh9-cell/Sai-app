export type {
  IntelligenceAttackGraph,
  IntelligenceGraphEdge,
  IntelligenceGraphNode,
  IntelligenceEdgeKind,
  IntelligenceNodeKind,
} from "./models";

export function mergeGraphs(
  base: import("./models").IntelligenceAttackGraph,
  extra: import("./models").IntelligenceAttackGraph
): import("./models").IntelligenceAttackGraph {
  const nodeIds = new Set(base.nodes.map((n) => n.id));
  const nodes = [...base.nodes];
  for (const node of extra.nodes) {
    if (!nodeIds.has(node.id)) {
      nodes.push(node);
      nodeIds.add(node.id);
    }
  }
  const edgeKeys = new Set(base.edges.map((e) => `${e.from}|${e.to}|${e.kind}`));
  const edges = [...base.edges];
  for (const edge of extra.edges) {
    const key = `${edge.from}|${edge.to}|${edge.kind}`;
    if (!edgeKeys.has(key)) {
      edges.push(edge);
      edgeKeys.add(key);
    }
  }
  return { nodes, edges };
}
