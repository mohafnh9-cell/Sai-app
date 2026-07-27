import type { AIFinding, AIFindingCollection } from "./finding.types";
import { hasValidatedRuntimeEvidence } from "./finding-correlation";

export function validateFinding(finding: AIFinding): AIFindingCollection["validationIssues"] {
  const issues: AIFindingCollection["validationIssues"] = [];

  if (!hasValidatedRuntimeEvidence(finding.evidence)) {
    issues.push({
      findingId: finding.findingId,
      code: "missing_runtime_evidence",
      message: "Finding lacks validated runtime-backed evidence.",
    });
  }

  if (!finding.traceability.invariantId) {
    issues.push({
      findingId: finding.findingId,
      code: "missing_invariant",
      message: "Finding must reference a trust invariant.",
    });
  }

  if (finding.traceability.graphNodeIds.length === 0) {
    issues.push({
      findingId: finding.findingId,
      code: "missing_graph_nodes",
      message: "Finding must reference execution graph nodes.",
    });
  }

  if (!finding.replayPlan?.id) {
    issues.push({
      findingId: finding.findingId,
      code: "missing_replay",
      message: "Finding must include replay plan.",
    });
  }

  if (!finding.fixContext?.invariantToRestoreId) {
    issues.push({
      findingId: finding.findingId,
      code: "missing_fix_context",
      message: "Finding must include AI fix context.",
    });
  }

  if (!finding.attackPreconditions?.requiredAttackerCapability) {
    issues.push({
      findingId: finding.findingId,
      code: "missing_preconditions",
      message: "Finding must include attack preconditions.",
    });
  }

  if (finding.confidence === "unsupported") {
    issues.push({
      findingId: finding.findingId,
      code: "unsupported_confidence",
      message: "Finding confidence unsupported.",
    });
  }

  return issues;
}

export function validateFindingCollection(collection: AIFindingCollection): AIFindingCollection {
  const issues = collection.findings.flatMap(validateFinding);
  const accepted = collection.findings.filter(
    (f) => !issues.some((i) => i.findingId === f.findingId && i.code === "missing_runtime_evidence")
  );
  return {
    ...collection,
    findings: accepted,
    validationIssues: [...collection.validationIssues, ...issues],
  };
}

export const AIFindingValidator = {
  validateFinding,
  validateCollection: validateFindingCollection,
};
