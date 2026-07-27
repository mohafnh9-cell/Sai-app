import { randomUUID } from "node:crypto";
import type { BusinessStateMachine, BusinessTransition, BusinessWorkflow } from "../model/domain.types";
import type { BusinessInvariant, BusinessInvariantCategory } from "../invariants/invariant.types";
import type {
  AbuseGenerationInput,
  AbuseStrategy,
  AbuseStrategyContext,
  BusinessAbuseCase,
  BusinessAbuseCollection,
  BusinessAbuseEvidence,
  BusinessAbuseResult,
  BusinessAbuseSequence,
  BusinessAbuseSequenceStep,
} from "./abuse.types";
import { BusinessAbusePlanner } from "./abuse-planner";
import { abuseConfidenceFromInvariant, maxEvidenceConfidence } from "./abuse-confidence";
import { validateAbuseCollection } from "./abuse-validator";
import { defaultAbuseStrategies } from "./abuse-strategies";

export function generateBusinessAbuseCases(
  input: AbuseGenerationInput,
  extensionStrategies: AbuseStrategy[] = []
): BusinessAbuseResult {
  const invariants = input.domain.invariantCollection?.invariants ?? [];
  const planned = BusinessAbusePlanner.plan(invariants);
  const strategies = BusinessAbusePlanner.mergeStrategies(defaultAbuseStrategies, extensionStrategies);

  const rawCases: BusinessAbuseCase[] = [];

  for (const invariant of planned) {
    const workflow = input.domain.workflows.find((w) => w.id === invariant.workflowId);
    const machine = input.domain.stateMachines.find((m) => m.id === invariant.stateMachineId);
    if (!workflow || !machine) continue;

    const ctx: AbuseStrategyContext = {
      invariant,
      workflow,
      machine,
      entities: input.domain.entities,
    };

    for (const strategy of strategies) {
      if (!strategy.invariantCategories.includes(invariant.category)) continue;
      rawCases.push(...strategy.generate(ctx));
    }
  }

  const deduped = dedupeAbuseCases(rawCases);
  const collection: BusinessAbuseCollection = {
    id: randomUUID(),
    cases: deduped,
    validationIssues: [],
    generatedAt: new Date().toISOString(),
  };

  const validated = validateAbuseCollection(collection, input.domain);
  const accepted = validated.cases;
  const rejected = validated.validationIssues.length;

  return {
    collection: validated,
    plannedInvariantCount: planned.length,
    generatedCount: deduped.length,
    acceptedCount: accepted.length,
    rejectedCount: rejected,
  };
}

export function buildSequenceFromTransition(input: {
  machine: BusinessStateMachine;
  transition: BusinessTransition;
  priorStateId?: string | null;
  actorRole: string;
  actionKind: BusinessAbuseSequenceStep["action"]["kind"];
  actionLabel: string;
  invariantViolationSummary: string;
  businessConsequence: string;
  extraStep?: BusinessAbuseSequenceStep | null;
}): BusinessAbuseSequence {
  const fromState = input.machine.states.find((s) => s.id === input.transition.fromStateId);
  const toState = input.machine.states.find((s) => s.id === input.transition.toStateId);
  const steps: BusinessAbuseSequenceStep[] = [];

  if (input.priorStateId && input.priorStateId !== input.transition.fromStateId) {
    const prior = input.machine.states.find((s) => s.id === input.priorStateId);
    steps.push({
      order: 1,
      stateId: input.priorStateId,
      stateName: prior?.name ?? input.priorStateId,
      action: {
        id: randomUUID(),
        kind: "out_of_band",
        label: "Reach state without prerequisite transitions",
        event: null,
        actorRole: input.actorRole,
      },
      transitionId: null,
      transitionEvent: null,
      toStateId: input.transition.fromStateId,
      toStateName: fromState?.name ?? input.transition.fromStateId,
      note: "Stale or skipped prerequisite state",
    });
  }

  const baseOrder = steps.length + 1;
  steps.push({
    order: baseOrder,
    stateId: input.transition.fromStateId,
    stateName: fromState?.name ?? input.transition.fromStateId,
    action: {
      id: randomUUID(),
      kind: input.actionKind,
      label: input.actionLabel,
      event: input.transition.event,
      actorRole: input.actorRole,
    },
    transitionId: input.transition.id,
    transitionEvent: input.transition.event,
    toStateId: input.transition.toStateId,
    toStateName: toState?.name ?? input.transition.toStateId,
    note: null,
  });

  if (input.extraStep) {
    steps.push({ ...input.extraStep, order: baseOrder + 1 });
  }

  return {
    id: randomUUID(),
    steps,
    invariantViolationSummary: input.invariantViolationSummary,
    businessConsequence: input.businessConsequence,
  };
}

export function invariantEvidenceToAbuse(
  invariant: BusinessInvariant,
  workflow: BusinessWorkflow
): BusinessAbuseEvidence[] {
  return [
    ...invariant.evidence.map((e) => ({
      id: randomUUID(),
      source: "invariant" as const,
      detail: e.detail,
      confidence: e.confidence,
      refId: e.id,
    })),
    ...workflow.metadata.evidence.slice(0, 3).map((e) => ({
      id: randomUUID(),
      source: "discovery" as const,
      detail: e.detail,
      confidence: e.confidence,
      refId: e.id,
    })),
  ];
}

export function primaryActorRole(workflow: BusinessWorkflow): string {
  return workflow.actors[0]?.role ?? "customer";
}

export function severityForCategory(
  category: BusinessAbuseCase["category"]
): BusinessAbuseCase["severity"] {
  if (
    category === "double_spend" ||
    category === "cross_workflow_abuse" ||
    category === "webhook_replay" ||
    category === "economic_abuse"
  ) {
    return "critical";
  }
  if (category === "race_condition" || category === "entitlement_abuse" || category === "coupon_replay") {
    return "high";
  }
  if (category === "trial_replay" || category === "quota_bypass") return "medium";
  return "medium";
}

function dedupeAbuseCases(cases: BusinessAbuseCase[]): BusinessAbuseCase[] {
  const map = new Map<string, BusinessAbuseCase>();
  for (const abuseCase of cases) {
    const existing = map.get(abuseCase.abuseKey);
    if (!existing) {
      map.set(abuseCase.abuseKey, abuseCase);
      continue;
    }
    if (
      confidenceRank(abuseCase.confidence) < confidenceRank(existing.confidence)
    ) {
      map.set(abuseCase.abuseKey, abuseCase);
    }
  }
  return [...map.values()];
}

function confidenceRank(confidence: BusinessAbuseCase["confidence"]): number {
  const order = ["confirmed", "highly_likely", "likely", "possible", "unsupported"];
  return order.indexOf(confidence);
}

export const BusinessAbuseGenerator = { generate: generateBusinessAbuseCases };

export function categoriesForExtension(): BusinessInvariantCategory[] {
  return defaultAbuseStrategies.flatMap((s) => s.invariantCategories);
}
