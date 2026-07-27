import type { BusinessInvariant, BusinessInvariantCollection, BusinessInvariantViolation } from "./invariant.types";
import { invariantPassesMinimumBar } from "./invariant-confidence";

export function validateBusinessInvariants(invariants: BusinessInvariant[]): BusinessInvariantViolation[] {
  const violations: BusinessInvariantViolation[] = [];

  for (const invariant of invariants) {
    if (!invariant.workflowId) {
      violations.push({
        id: `v-${invariant.id}-wf`,
        invariantId: invariant.id,
        code: "missing_workflow_ref",
        message: "Invariant is missing workflow reference.",
      });
    }
    if (!invariant.stateMachineId) {
      violations.push({
        id: `v-${invariant.id}-fsm`,
        invariantId: invariant.id,
        code: "missing_fsm_ref",
        message: "Invariant is missing state machine reference.",
      });
    }
    if (invariant.evidence.length === 0) {
      violations.push({
        id: `v-${invariant.id}-ev`,
        invariantId: invariant.id,
        code: "missing_evidence",
        message: "Invariant has no supporting evidence.",
      });
    }
    if (!invariantPassesMinimumBar(invariant)) {
      violations.push({
        id: `v-${invariant.id}-conf`,
        invariantId: invariant.id,
        code: "unsupported_confidence",
        message: "Invariant confidence is unsupported or below evidence threshold.",
      });
    }
    if (!invariant.whyItExists.trim()) {
      violations.push({
        id: `v-${invariant.id}-why`,
        invariantId: invariant.id,
        code: "missing_evidence",
        message: "Invariant missing whyItExists explanation.",
      });
    }
  }

  return violations;
}

export function validateInvariantCollection(
  collection: BusinessInvariantCollection
): BusinessInvariantCollection {
  const validationViolations = validateBusinessInvariants(collection.invariants);
  return {
    ...collection,
    validationViolations: [...collection.validationViolations, ...validationViolations],
  };
}
