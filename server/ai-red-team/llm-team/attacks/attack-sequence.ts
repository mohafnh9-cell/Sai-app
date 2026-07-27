import type { AIExecutionGraph, AIExecutionNodeKind } from "../model/execution-graph.types";
import type { AIInvariant } from "../invariants/invariant.types";
import { stableAiId } from "../model/stable-id";
import type {
  AIAttackAction,
  AIAttackActionKind,
  AIAttackerCapability,
  AIAttackSequence,
  AIAttackStep,
} from "./attack.types";

export type SequenceBlueprintStep = {
  nodeKind: AIExecutionNodeKind | "attack" | "invariant_violation";
  actionKind: AIAttackActionKind;
  actionLabel: string;
  capability: AIAttackerCapability;
  marksViolation?: boolean;
  note?: string | null;
};

export function firstNodeId(graph: AIExecutionGraph, kind: AIExecutionNodeKind): string | null {
  return graph.nodes.find((n) => n.kind === kind)?.id ?? null;
}

export function resolveNodeId(
  graph: AIExecutionGraph,
  invariant: AIInvariant,
  kind: AIExecutionNodeKind
): string | null {
  const fromInv = invariant.relationships.graphNodeIds.find((id) => {
    const node = graph.nodes.find((n) => n.id === id);
    return node?.kind === kind;
  });
  return fromInv ?? firstNodeId(graph, kind);
}

export function buildAttackSequence(input: {
  graph: AIExecutionGraph;
  invariant: AIInvariant;
  pathId: string | null;
  blueprint: SequenceBlueprintStep[];
  violationSummary: string;
  expectedConsequence: string;
}): AIAttackSequence {
  const graphNodeIds = new Set<string>();
  const graphEdgeIds = new Set<string>();
  const steps: AIAttackStep[] = [];

  let order = 1;
  for (const bp of input.blueprint) {
    let nodeId: string | null = null;
    let label = bp.actionLabel;

    if (bp.nodeKind !== "attack" && bp.nodeKind !== "invariant_violation") {
      nodeId = resolveNodeId(input.graph, input.invariant, bp.nodeKind);
      if (nodeId) {
        graphNodeIds.add(nodeId);
        const node = input.graph.nodes.find((n) => n.id === nodeId);
        label = node?.label ?? bp.nodeKind;
      }
    } else if (bp.nodeKind === "invariant_violation") {
      label = input.invariant.title;
    }

    const action: AIAttackAction = {
      id: stableAiId(`attack-action:${input.invariant.invariantKey}:${order}:${bp.actionKind}`),
      kind: bp.actionKind,
      label: bp.actionLabel,
      attackerCapability: bp.capability,
    };

    const touching =
      nodeId != null
        ? input.graph.edges.filter((e) => e.fromNodeId === nodeId || e.toNodeId === nodeId)
        : [];
    const edgeId = touching[0]?.id ?? null;
    if (edgeId) graphEdgeIds.add(edgeId);

    steps.push({
      order,
      nodeId,
      nodeKind: bp.nodeKind,
      label,
      action,
      graphEdgeId: edgeId,
      marksInvariantViolation: bp.marksViolation ?? bp.nodeKind === "invariant_violation",
      note: bp.note ?? null,
    });
    order += 1;
  }

  for (const id of input.invariant.relationships.graphNodeIds) {
    graphNodeIds.add(id);
  }

  return {
    id: stableAiId(`attack-seq:${input.invariant.invariantKey}:${input.blueprint.map((b) => b.actionKind).join("-")}`),
    executionPathId: input.pathId,
    graphNodeIds: [...graphNodeIds],
    graphEdgeIds: [...graphEdgeIds],
    steps,
    invariantViolationSummary: input.violationSummary,
    expectedConsequence: input.expectedConsequence,
  };
}

export function sequenceRequiresNodes(
  graph: AIExecutionGraph,
  kinds: AIExecutionNodeKind[]
): boolean {
  return kinds.every((k) => graph.nodes.some((n) => n.kind === k));
}
