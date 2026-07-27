import { createHash } from "node:crypto";
import type { BusinessAbuseCase } from "../abuse/abuse.types";
import type { BusinessInvariant } from "../invariants/invariant.types";
import type { BusinessDomainModel, BusinessStateMachine } from "../model/domain.types";
import type {
  BusinessLogicExecutionEvidence,
  BusinessLogicExecutionPlan,
  BusinessLogicExecutionStep,
} from "./runtime.types";

export type MockSimulationOutcome = {
  invariantViolated: boolean;
  businessConsequence: string | null;
  validatedTransitions: BusinessLogicExecutionStep[];
  validatedAssumptions: string[];
  rejectedAssumptions: string[];
  evidence: BusinessLogicExecutionEvidence[];
  evaluationsUsed: number;
  transitionsUsed: number;
};

function machineForWorkflow(
  domain: BusinessDomainModel,
  workflowId: string
): BusinessStateMachine | null {
  const workflow = domain.workflows.find((w) => w.id === workflowId);
  if (!workflow) return null;
  return domain.stateMachines.find((m) => m.id === workflow.stateMachineId) ?? null;
}

function stableEvidenceId(planId: string, ref: string): string {
  return createHash("sha256").update(`${planId}:${ref}`).digest("hex").slice(0, 32);
}

function stepsFromAbuseSequence(input: {
  planId: string;
  machine: BusinessStateMachine;
  abuseCase: BusinessAbuseCase | null;
}): BusinessLogicExecutionStep[] {
  if (!input.abuseCase) return [];
  return input.abuseCase.sequence.steps.map((step, index) => ({
    id: stableEvidenceId(input.planId, `step-${index}`),
    order: index + 1,
    transitionId: step.transitionId,
    transitionEvent: step.transitionEvent,
    fromStateId: step.stateId,
    toStateId: step.toStateId,
    actionKind: step.action.kind,
    economicEffect: null,
    note: step.note,
  }));
}

function violationForOrderingAbuse(abuseCase: BusinessAbuseCase | null): boolean {
  if (!abuseCase) return false;
  const abusive = new Set([
    "workflow_bypass",
    "invalid_ordering",
    "state_skipping",
    "double_spend",
    "webhook_ordering_abuse",
    "duplicate_execution",
    "coupon_replay",
    "credit_duplication",
    "quota_bypass",
    "subscription_resurrection",
    "trial_replay",
    "race_condition",
    "retry_abuse",
    "concurrent_execution",
  ]);
  return abusive.has(abuseCase.category);
}

export function simulateMockExecution(input: {
  domain: BusinessDomainModel;
  plan: BusinessLogicExecutionPlan;
  invariant: BusinessInvariant;
  abuseCase: BusinessAbuseCase | null;
  maxTransitions: number;
}): MockSimulationOutcome {
  const machine = machineForWorkflow(input.domain, input.plan.workflowId);
  const validatedTransitions = machine
    ? stepsFromAbuseSequence({
        planId: input.plan.id,
        machine,
        abuseCase: input.abuseCase,
      }).slice(0, input.maxTransitions)
    : [];

  const evidence: BusinessLogicExecutionEvidence[] = [
    ...input.invariant.evidence.map((e) => ({
      id: stableEvidenceId(input.plan.id, `inv-${e.id}`),
      source: "invariant" as const,
      detail: e.detail,
      confidence: e.confidence,
      refId: e.id,
    })),
    ...(input.abuseCase?.evidence.map((e) => ({
      id: stableEvidenceId(input.plan.id, `abuse-${e.id}`),
      source: "runtime_mock" as const,
      detail: e.detail,
      confidence: e.confidence,
      refId: e.id,
    })) ?? []),
  ];

  if (machine) {
    evidence.push({
      id: stableEvidenceId(input.plan.id, `fsm-${machine.id}`),
      source: "fsm",
      detail: `Mock FSM ${machine.id} — ${validatedTransitions.length} transition(s) simulated.`,
      confidence: 0.82,
      refId: machine.id,
    });
  }

  const orderingViolation = violationForOrderingAbuse(input.abuseCase);
  const invariantViolated =
    !!input.abuseCase &&
    (input.plan.executionMode === "mock_runtime" ||
      input.plan.executionMode === "simulation_only") &&
    orderingViolation;

  const validatedAssumptions = input.plan.assumptions.filter((a) => a.length > 0).slice(0, 4);
  const rejectedAssumptions =
    invariantViolated && input.abuseCase
      ? input.abuseCase.assumptions.filter((a) => a.required).map((a) => a.statement)
      : [];

  return {
    invariantViolated,
    businessConsequence: invariantViolated
      ? input.abuseCase?.sequence.businessConsequence ??
        input.invariant.potentialImpact
      : null,
    validatedTransitions,
    validatedAssumptions,
    rejectedAssumptions,
    evidence,
    evaluationsUsed: Math.max(1, validatedTransitions.length),
    transitionsUsed: validatedTransitions.length,
  };
}

export const MockBusinessLogicSimulator = {
  simulate: simulateMockExecution,
};
