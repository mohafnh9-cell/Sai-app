import type { BusinessLogicFinding, BusinessLogicFindingCollection } from "./finding.types";
import { hasRuntimeBackedEvidence } from "./finding-correlation";

export function validateFinding(finding: BusinessLogicFinding): BusinessLogicFinding {
  const issues: { findingId: string; code: string; message: string }[] = [];

  if (!hasRuntimeBackedEvidence(finding.evidence)) {
    issues.push({
      findingId: finding.findingId,
      code: "missing_runtime_evidence",
      message: "Finding lacks runtime-backed evidence.",
    });
    return { ...finding, status: "rejected" };
  }

  if (finding.invariantIds.length === 0) {
    issues.push({
      findingId: finding.findingId,
      code: "missing_invariant",
      message: "Finding must reference an invariant.",
    });
    return { ...finding, status: "rejected" };
  }

  if (!finding.workflowId) {
    return { ...finding, status: "rejected" };
  }

  if (!finding.replayPlan || finding.replayPlan.sequence.steps.length === 0) {
    return { ...finding, status: "rejected" };
  }

  if (finding.mitigation.recommendations.length === 0) {
    return { ...finding, status: "rejected" };
  }

  if (finding.confidence === "unsupported") {
    return { ...finding, status: "rejected" };
  }

  return finding;
}

export function validateFindingCollection(
  collection: BusinessLogicFindingCollection
): BusinessLogicFindingCollection {
  const findings = collection.findings.map(validateFinding);
  const validationIssues = [...collection.validationIssues];

  for (const finding of findings) {
    if (finding.status === "rejected") {
      validationIssues.push({
        findingId: finding.findingId,
        code: "rejected",
        message: "Finding failed validation gates.",
      });
    }
  }

  return {
    ...collection,
    findings: findings.filter((f) => f.status !== "rejected"),
    validationIssues,
  };
}

export const BusinessLogicFindingValidator = {
  validate: validateFinding,
  validateCollection: validateFindingCollection,
};
