import { randomUUID } from "node:crypto";
import type { BusinessAbuseCase } from "../abuse/abuse.types";
import type { BusinessInvariant } from "../invariants/invariant.types";
import type { BusinessWorkflow } from "../model/domain.types";
import type { DiscoveredBusinessWorkflowKind } from "../discovery/discovery.types";
import type {
  BusinessLogicSpecialistContext,
  BusinessLogicSpecialistPlan,
  BusinessLogicSpecialistValidationStep,
} from "./specialist.types";
import { BUSINESS_LOGIC_SPECIALIST_MAX_VALIDATION_STEPS } from "./specialist.types";

export function domainWorkflowsForKinds(
  context: BusinessLogicSpecialistContext,
  kinds: DiscoveredBusinessWorkflowKind[]
): BusinessWorkflow[] {
  const kindSet = new Set(kinds);
  return context.domain.workflows.filter((w) =>
    kindSet.has(w.metadata.discoveredWorkflowKind as DiscoveredBusinessWorkflowKind)
  );
}

export function selectInvariants(input: {
  context: BusinessLogicSpecialistContext;
  workflowIds: string[];
  categories: BusinessInvariant["category"][];
}): BusinessInvariant[] {
  const workflowSet = new Set(input.workflowIds);
  const categorySet = new Set(input.categories);
  const invariants = input.context.domain.invariantCollection?.invariants ?? [];
  return invariants.filter(
    (inv) => workflowSet.has(inv.workflowId) && categorySet.has(inv.category)
  );
}

export function selectAbuseCases(input: {
  context: BusinessLogicSpecialistContext;
  invariantIds: string[];
  categories?: BusinessAbuseCase["category"][];
}): BusinessAbuseCase[] {
  const invariantSet = new Set(input.invariantIds);
  const categorySet = input.categories ? new Set(input.categories) : null;
  const cases = input.context.domain.abuseCollection?.cases ?? [];
  return cases.filter((abuseCase) => {
    if (!invariantSet.has(abuseCase.targetInvariantId)) return false;
    if (categorySet && !categorySet.has(abuseCase.category)) return false;
    return true;
  });
}

export function collectEvidenceRefIds(input: {
  invariants: BusinessInvariant[];
  abuseCases: BusinessAbuseCase[];
}): string[] {
  const refs = new Set<string>();
  for (const inv of input.invariants) {
    for (const ev of inv.evidence) refs.add(ev.id);
  }
  for (const abuseCase of input.abuseCases) {
    for (const ev of abuseCase.evidence) refs.add(ev.id);
  }
  return [...refs];
}

export function buildValidationSteps(input: {
  invariants: BusinessInvariant[];
  abuseCases: BusinessAbuseCase[];
  intentPrefix: string;
}): BusinessLogicSpecialistValidationStep[] {
  const steps: BusinessLogicSpecialistValidationStep[] = [];
  const abuseByInvariant = new Map<string, BusinessAbuseCase[]>();
  for (const abuseCase of input.abuseCases) {
    const list = abuseByInvariant.get(abuseCase.targetInvariantId) ?? [];
    list.push(abuseCase);
    abuseByInvariant.set(abuseCase.targetInvariantId, list);
  }

  let order = 1;
  for (const invariant of input.invariants) {
    if (order > BUSINESS_LOGIC_SPECIALIST_MAX_VALIDATION_STEPS) break;
    const linked = abuseByInvariant.get(invariant.id) ?? [];
    const abuseCase = linked[0] ?? null;
    const evidenceRefIds = [
      ...invariant.evidence.map((e) => e.id),
      ...(abuseCase?.evidence.map((e) => e.id) ?? []),
    ];
    steps.push({
      id: randomUUID(),
      order,
      intent: `${input.intentPrefix}: ${invariant.title}`,
      targetInvariantId: invariant.id,
      targetAbuseCaseId: abuseCase?.id ?? null,
      validationMode: abuseCase ? "future_runtime" : "static_review",
      evidenceRefIds,
    });
    order += 1;
  }

  for (const abuseCase of input.abuseCases) {
    if (order > BUSINESS_LOGIC_SPECIALIST_MAX_VALIDATION_STEPS) break;
    if (steps.some((s) => s.targetAbuseCaseId === abuseCase.id)) continue;
    steps.push({
      id: randomUUID(),
      order,
      intent: `${input.intentPrefix}: validate abuse hypothesis "${abuseCase.title}"`,
      targetInvariantId: abuseCase.targetInvariantId,
      targetAbuseCaseId: abuseCase.id,
      validationMode: "future_runtime",
      evidenceRefIds: abuseCase.evidence.map((e) => e.id),
    });
    order += 1;
  }

  return steps.slice(0, BUSINESS_LOGIC_SPECIALIST_MAX_VALIDATION_STEPS);
}

export function buildSpecialistPlan(input: {
  specialistId: string;
  context: BusinessLogicSpecialistContext;
  workflowIds: string[];
  invariants: BusinessInvariant[];
  abuseCases: BusinessAbuseCase[];
  intentPrefix: string;
  selectionRationale: string;
  assumptions: string[];
}): BusinessLogicSpecialistPlan {
  const validationSteps = buildValidationSteps({
    invariants: input.invariants,
    abuseCases: input.abuseCases,
    intentPrefix: input.intentPrefix,
  });

  return {
    id: randomUUID(),
    specialistId: input.specialistId,
    workflowIds: input.workflowIds,
    invariantIds: input.invariants.map((i) => i.id),
    abuseCaseIds: input.abuseCases.map((a) => a.id),
    validationSteps,
    boundedStepCount: validationSteps.length,
    assumptions: input.assumptions,
    selectionRationale: input.selectionRationale,
  };
}

export function eligibilityFromWorkflows(input: {
  context: BusinessLogicSpecialistContext;
  kinds: DiscoveredBusinessWorkflowKind[];
  specialistLabel: string;
}): {
  workflows: BusinessWorkflow[];
  eligibility: import("./specialist.types").BusinessLogicSpecialistEligibility;
} {
  const workflows = domainWorkflowsForKinds(input.context, input.kinds);
  if (workflows.length === 0) {
    return {
      workflows: [],
      eligibility: {
        eligible: false,
        reason: `${input.specialistLabel} skipped — no matching workflows (${input.kinds.join(", ")}).`,
        matchedWorkflowKinds: [],
        matchedWorkflowIds: [],
      },
    };
  }

  const matchedKinds = [
    ...new Set(
      workflows.map(
        (w) => w.metadata.discoveredWorkflowKind as DiscoveredBusinessWorkflowKind
      )
    ),
  ];

  return {
    workflows,
    eligibility: {
      eligible: true,
      reason: `${input.specialistLabel} selected — ${workflows.length} workflow(s) match ${matchedKinds.join(", ")}.`,
      matchedWorkflowKinds: matchedKinds,
      matchedWorkflowIds: workflows.map((w) => w.id),
    },
  };
}
