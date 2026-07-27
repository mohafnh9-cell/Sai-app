import type { AIExecutionGraph } from "../model/execution-graph.types";
import type { AIInvariantEvidenceSource } from "./invariant.types";
import { stableAiId } from "../model/stable-id";

export function evidenceFromGraph(
  source: AIInvariantEvidenceSource,
  detail: string,
  confidence: number,
  refId?: string | null
) {
  return {
    id: stableAiId(`inv-ev:${source}:${detail}`),
    source,
    detail,
    confidence,
    refId: refId ?? null,
  };
}

export function nodeIdsByKind(graph: AIExecutionGraph, kind: string): string[] {
  return graph.nodes.filter((n) => n.kind === kind).map((n) => n.id);
}

export function edgesTouching(graph: AIExecutionGraph, nodeId: string): string[] {
  return graph.edges
    .filter((e) => e.fromNodeId === nodeId || e.toNodeId === nodeId)
    .map((e) => e.id);
}

export function canonicalPathId(graph: AIExecutionGraph): string | null {
  return graph.paths.find((p) => p.purpose === "canonical_happy_path")?.id ?? graph.paths[0]?.id ?? null;
}

export function boundaryByKind(graph: AIExecutionGraph, kind: string) {
  return graph.boundaries.find((b) => b.kind === kind) ?? null;
}
