import type { AIExecutionGraph } from "../model/execution-graph.types";
import type { AIInvariantCollection } from "../invariants/invariant.types";
import type {
  AIAttackCase,
  AIAttackCollection,
  AIAttackValidationIssue,
} from "./attack.types";
import { stableAiId } from "../model/stable-id";

export function validateAttackCase(
  attackCase: AIAttackCase,
  graph: AIExecutionGraph,
  invariants: AIInvariantCollection
): AIAttackValidationIssue[] {
  const issues: AIAttackValidationIssue[] = [];
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const boundaryIds = new Set(graph.boundaries.map((b) => b.id));
  const pathIds = new Set(graph.paths.map((p) => p.id));

  const invariant = invariants.invariants.find((i) => i.id === attackCase.targetInvariantId);
  if (!invariant) {
    issues.push({
      id: stableAiId(`av:${attackCase.id}:missing_inv`),
      attackCaseId: attackCase.id,
      code: "missing_invariant",
      message: "Target invariant not found in collection.",
    });
  }

  if (!attackCase.targetTrustBoundaryId || !boundaryIds.has(attackCase.targetTrustBoundaryId)) {
    issues.push({
      id: stableAiId(`av:${attackCase.id}:boundary`),
      attackCaseId: attackCase.id,
      code: "missing_boundary",
      message: "Attack references missing or unknown trust boundary.",
    });
  }

  if (attackCase.confidence === "unsupported") {
    issues.push({
      id: stableAiId(`av:${attackCase.id}:spec`),
      attackCaseId: attackCase.id,
      code: "speculative",
      message: "Attack confidence is unsupported.",
    });
  }

  if (attackCase.evidence.length === 0) {
    issues.push({
      id: stableAiId(`av:${attackCase.id}:ev`),
      attackCaseId: attackCase.id,
      code: "unsupported_assumption_only",
      message: "Attack has no evidence.",
    });
  }

  if (
    attackCase.assumptions.length > 0 &&
    attackCase.evidence.every((e) => e.confidence < 0.5)
  ) {
    issues.push({
      id: stableAiId(`av:${attackCase.id}:asm`),
      attackCaseId: attackCase.id,
      code: "unsupported_assumption_only",
      message: "Attack relies on assumptions without sufficient evidence.",
    });
  }

  if (attackCase.metadata.providerFamily) {
    issues.push({
      id: stableAiId(`av:${attackCase.id}:provider`),
      attackCaseId: attackCase.id,
      code: "provider_specific",
      message: "Attack metadata must remain provider-independent.",
    });
  }

  if (attackCase.sequence.graphNodeIds.length === 0) {
    issues.push({
      id: stableAiId(`av:${attackCase.id}:nodes`),
      attackCaseId: attackCase.id,
      code: "missing_graph_nodes",
      message: "Attack sequence must reference execution graph nodes.",
    });
  }

  for (const nid of attackCase.sequence.graphNodeIds) {
    if (!nodeIds.has(nid)) {
      issues.push({
        id: stableAiId(`av:${attackCase.id}:node:${nid.slice(0, 8)}`),
        attackCaseId: attackCase.id,
        code: "impossible_topology",
        message: `Sequence references unknown node ${nid}.`,
      });
    }
  }

  if (
    attackCase.sequence.executionPathId &&
    !pathIds.has(attackCase.sequence.executionPathId)
  ) {
    issues.push({
      id: stableAiId(`av:${attackCase.id}:path`),
      attackCaseId: attackCase.id,
      code: "impossible_path",
      message: "Attack references execution path not present in graph.",
    });
  }

  for (const step of attackCase.sequence.steps) {
    if (step.nodeId && !nodeIds.has(step.nodeId)) {
      issues.push({
        id: stableAiId(`av:${attackCase.id}:step:${step.order}`),
        attackCaseId: attackCase.id,
        code: "impossible_topology",
        message: `Step ${step.order} references missing node.`,
      });
    }
  }

  const requiresTool = attackCase.category.includes("tool") || attackCase.category === "unauthorized_tool_invocation";
  if (requiresTool && !graph.nodes.some((n) => n.kind === "tool") && attackCase.category !== "mcp_tool_abuse") {
    if (attackCase.category === "tool_abuse" || attackCase.category === "unauthorized_tool_invocation") {
      issues.push({
        id: stableAiId(`av:${attackCase.id}:comp`),
        attackCaseId: attackCase.id,
        code: "missing_component",
        message: "Tool attack requires tool nodes in graph.",
      });
    }
  }

  return issues;
}

const HARD_REJECT: AIAttackValidationIssue["code"][] = [
  "missing_invariant",
  "missing_boundary",
  "missing_graph_nodes",
  "impossible_path",
  "impossible_topology",
  "speculative",
  "missing_component",
  "provider_specific",
];

export function validateAttackCollection(
  collection: AIAttackCollection,
  graph: AIExecutionGraph,
  invariants: AIInvariantCollection
): AIAttackCollection {
  const validationIssues: AIAttackValidationIssue[] = [];
  const accepted: AIAttackCase[] = [];

  for (const attackCase of collection.cases) {
    const issues = validateAttackCase(attackCase, graph, invariants);
    if (issues.length === 0) {
      accepted.push(attackCase);
      continue;
    }
    validationIssues.push(...issues);
    const hard = issues.some((i) => HARD_REJECT.includes(i.code));
    if (!hard) accepted.push(attackCase);
  }

  return {
    ...collection,
    cases: accepted,
    validationIssues: [...collection.validationIssues, ...validationIssues],
  };
}

export const AIAttackValidator = {
  validateCase: validateAttackCase,
  validateCollection: validateAttackCollection,
};
