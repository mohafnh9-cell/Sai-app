import type { BusinessDomainModel } from "../model/domain.types";
import type {
  BusinessAbuseCollection,
  BusinessAbuseCase,
  BusinessAbuseValidationIssue,
} from "./abuse.types";

export function validateAbuseCase(
  abuseCase: BusinessAbuseCase,
  domain: BusinessDomainModel
): BusinessAbuseValidationIssue[] {
  const issues: BusinessAbuseValidationIssue[] = [];
  const machine = domain.stateMachines.find((m) => m.id === abuseCase.targetStateMachineId);
  const invariant = domain.invariantCollection?.invariants.find(
    (i) => i.id === abuseCase.targetInvariantId
  );

  if (!invariant) {
    issues.push({
      id: `av-${abuseCase.id}-inv`,
      abuseCaseId: abuseCase.id,
      code: "missing_invariant",
      message: "Target invariant not found in collection.",
    });
  }

  if (abuseCase.confidence === "unsupported") {
    issues.push({
      id: `av-${abuseCase.id}-conf`,
      abuseCaseId: abuseCase.id,
      code: "speculative",
      message: "Abuse confidence is unsupported.",
    });
  }

  if (
    abuseCase.assumptions.length > 0 &&
    abuseCase.evidence.length === 0
  ) {
    issues.push({
      id: `av-${abuseCase.id}-spec`,
      abuseCaseId: abuseCase.id,
      code: "unsupported_assumption_only",
      message: "Abuse relies on assumptions without evidence.",
    });
  }

  if (!machine) return issues;

  for (const step of abuseCase.sequence.steps) {
    if (!step.transitionId || !step.transitionEvent) continue;

    const transition = machine.transitions.find((t) => t.id === step.transitionId);
    if (!transition) {
      issues.push({
        id: `av-${abuseCase.id}-tr-${step.order}`,
        abuseCaseId: abuseCase.id,
        code: "impossible_transition",
        message: `Transition id ${step.transitionId} not found on FSM.`,
      });
      continue;
    }

    if (step.action.kind !== "out_of_band" && step.stateId !== transition.fromStateId) {
      issues.push({
        id: `av-${abuseCase.id}-fsm-${step.order}`,
        abuseCaseId: abuseCase.id,
        code: "contradicts_fsm",
        message: `Step state ${step.stateId} does not match transition from-state ${transition.fromStateId}.`,
      });
    }

    if (
      step.action.kind !== "out_of_band" &&
      step.toStateId &&
      step.toStateId !== transition.toStateId
    ) {
      issues.push({
        id: `av-${abuseCase.id}-to-${step.order}`,
        abuseCaseId: abuseCase.id,
        code: "contradicts_fsm",
        message: `Step target state does not match transition definition.`,
      });
    }
  }

  return issues;
}

export function validateAbuseCollection(
  collection: BusinessAbuseCollection,
  domain: BusinessDomainModel
): BusinessAbuseCollection {
  const validationIssues: BusinessAbuseValidationIssue[] = [];
  const accepted: BusinessAbuseCase[] = [];

  for (const abuseCase of collection.cases) {
    const issues = validateAbuseCase(abuseCase, domain);
    if (issues.length > 0) {
      validationIssues.push(...issues);
      const hardReject = issues.some((i) =>
        ["contradicts_fsm", "impossible_transition", "missing_invariant", "speculative"].includes(i.code)
      );
      if (!hardReject) {
        accepted.push(abuseCase);
      }
    } else {
      accepted.push(abuseCase);
    }
  }

  return {
    ...collection,
    cases: accepted,
    validationIssues: [...collection.validationIssues, ...validationIssues],
  };
}

export const BusinessAbuseValidator = {
  validateCase: validateAbuseCase,
  validateCollection: validateAbuseCollection,
};
