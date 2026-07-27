import { createHash } from "node:crypto";
import type { BusinessAbuseCase } from "../abuse/abuse.types";
import type { BusinessInvariant } from "../invariants/invariant.types";
import type { BusinessLogicExecutionResult } from "../runtime/runtime.types";
import type {
  BusinessLogicFindingConfidence,
  BusinessReplayAction,
  BusinessReplayPlan,
} from "./finding.types";

function stableId(prefix: string, parts: string[]): string {
  return createHash("sha256").update(`${prefix}:${parts.join(":")}`).digest("hex").slice(0, 32);
}

export function buildReplayPlan(input: {
  findingId: string;
  invariant: BusinessInvariant;
  abuseCase: BusinessAbuseCase | null;
  execution: BusinessLogicExecutionResult;
  confidence: BusinessLogicFindingConfidence;
}): BusinessReplayPlan {
  const steps: BusinessReplayAction[] = [];
  let order = 1;

  if (input.abuseCase) {
    for (const step of input.abuseCase.sequence.steps) {
      steps.push({
        id: stableId("replay", [input.findingId, String(order)]),
        order,
        kind:
          step.action.kind === "parallel_request"
            ? "parallel_action"
            : step.action.kind === "repeat_request"
              ? "repeat_action"
              : "invoke_transition",
        label: step.action.label,
        transitionId: step.transitionId,
        event: step.action.event,
      });
      order += 1;
    }
  } else {
    for (const transition of input.execution.validatedTransitions) {
      steps.push({
        id: stableId("replay", [input.findingId, transition.id]),
        order,
        kind: "invoke_transition",
        label: transition.transitionEvent ?? "transition",
        transitionId: transition.transitionId,
        event: transition.transitionEvent,
      });
      order += 1;
    }
  }

  steps.push({
    id: stableId("replay", [input.findingId, "assert"]),
    order,
    kind: "assert_invariant",
    label: `Assert invariant: ${input.invariant.title}`,
    transitionId: null,
    event: null,
  });

  const preconditions = [
    ...input.execution.validatedAssumptions,
    "Non-production replay environment (RT11).",
  ];

  const validationCriteria = [
    `Invariant ${input.invariant.invariantKey} must hold after replay.`,
    input.abuseCase
      ? `Abuse outcome must not occur: ${input.abuseCase.expectedOutcome}`
      : "Workflow must reject invalid ordering or duplicate economic effect.",
  ];

  if (input.confidence !== "confirmed" && input.confidence !== "highly_likely") {
    validationCriteria.push("Finding confidence below confirmed — replay is advisory only.");
  }

  return {
    id: stableId("replay-plan", [input.findingId]),
    findingId: input.findingId,
    preconditions,
    sequence: { id: stableId("replay-seq", [input.findingId]), steps },
    expectedOutcome: input.abuseCase?.expectedOutcome ?? input.invariant.potentialImpact,
    validationCriteria,
    evidence: input.execution.evidence.map((e) => ({
      id: stableId("replay-ev", [input.findingId, e.id]),
      detail: e.detail,
      refId: e.refId ?? null,
    })),
    executable: input.confidence === "confirmed" || input.confidence === "highly_likely",
  };
}

export const BusinessReplayBridge = {
  buildPlan: buildReplayPlan,
};
