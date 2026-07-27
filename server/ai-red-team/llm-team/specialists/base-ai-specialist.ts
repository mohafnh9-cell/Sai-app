import { stableAiId } from "../model/stable-id";
import type {
  AISecuritySpecialist,
  AISpecialistContext,
  AISpecialistObservation,
  AISpecialistPlan,
  AISpecialistResult,
  AISpecialistValidationStep,
} from "./specialist.types";
import {
  AI_SPECIALIST_DEFAULT_RUNTIME_BUDGET_MS,
  AI_SPECIALIST_MAX_VALIDATION_STEPS,
} from "./specialist.types";
import {
  collectSpecialistEvidenceRefs,
  evaluateSpecialistEligibility,
  selectAttacksForSpecialist,
  selectInvariantsForSpecialist,
} from "./specialist-selection";
import type { AIAttackCase } from "../attacks/attack.types";
import type { AIInvariant } from "../invariants/invariant.types";

export abstract class BaseAiSecuritySpecialist implements AISecuritySpecialist {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly priority: number;
  abstract readonly supportedComponents: AISecuritySpecialist["supportedComponents"];
  abstract readonly supportedInvariantCategories: AISecuritySpecialist["supportedInvariantCategories"];
  abstract readonly supportedAttackCategories: AISecuritySpecialist["supportedAttackCategories"];
  abstract readonly supportedProviders: AISecuritySpecialist["supportedProviders"];
  abstract readonly supportedArchitectures: AISecuritySpecialist["supportedArchitectures"];

  protected abstract intentPrefix: string;
  protected abstract riskScope: string;
  protected abstract defaultAssumptions: string[];
  protected abstract requireGraphNodes: string[];

  canRun(context: AISpecialistContext) {
    return evaluateSpecialistEligibility({
      context,
      specialistLabel: this.name,
      supportedComponents: this.supportedComponents,
      supportedInvariantCategories: this.supportedInvariantCategories,
      supportedAttackCategories: this.supportedAttackCategories,
      supportedArchitectures: this.supportedArchitectures,
      requireGraphNodes: this.requireGraphNodes,
    });
  }

  async plan(context: AISpecialistContext): Promise<AISpecialistPlan> {
    const eligibility = this.canRun(context);
    const invariants = selectInvariantsForSpecialist({
      context,
      categories: [...this.supportedInvariantCategories],
    });
    const invariantIds = invariants.map((i) => i.id);
    const attacks = selectAttacksForSpecialist({
      context,
      invariantIds,
      categories: [...this.supportedAttackCategories],
    });

    const componentNodeIds = [
      ...new Set(
        invariants.flatMap((i) => i.relationships.protectedComponentNodeIds)
      ),
    ];

    const { steps, truncated } = buildValidationSteps({
      specialistId: this.id,
      invariants,
      attacks,
      intentPrefix: this.intentPrefix,
      graphNodeIds: componentNodeIds,
    });

    const expectedEvidenceRefIds = collectSpecialistEvidenceRefs({ invariants, attacks });

    return {
      id: stableAiId(`plan:${this.id}:${context.graph.id}`),
      specialistId: this.id,
      targetComponentNodeIds: componentNodeIds,
      targetInvariantIds: invariantIds,
      targetAttackCaseIds: attacks.map((a) => a.id),
      validationSteps: steps,
      expectedEvidenceRefIds,
      executionClassification: "static_plan_only",
      riskScope: this.riskScope,
      maximumRuntimeBudgetMs: AI_SPECIALIST_DEFAULT_RUNTIME_BUDGET_MS,
      requiredAssumptions: this.defaultAssumptions,
      selectionRationale: eligibility.reason,
      truncatedByBudget: truncated,
    };
  }

  async analyze(
    context: AISpecialistContext,
    plan: AISpecialistPlan
  ): Promise<Pick<AISpecialistResult, "observations">> {
    const attacks = selectAttacksForSpecialist({
      context,
      invariantIds: plan.targetInvariantIds,
      categories: [...this.supportedAttackCategories],
    });

    const observations: AISpecialistObservation[] = [];
    for (const attack of attacks) {
      observations.push(
        this.observation({
          componentNodeIds: attack.sequence.graphNodeIds.slice(0, 5),
          invariantId: attack.targetInvariantId,
          attackCaseId: attack.id,
          trustBoundaryId: attack.targetTrustBoundaryId,
          evidenceRefIds: attack.evidence.map((e) => e.id),
          confidence:
            attack.confidence === "confirmed"
              ? "confirmed"
              : attack.confidence === "highly_likely"
                ? "highly_likely"
                : attack.confidence === "likely"
                  ? "likely"
                  : "possible",
          status: "hypothesis_aligned",
          title: `Validate attack hypothesis: ${attack.title}`,
          detail: attack.expectedImpact,
          businessImpactCandidate: attack.expectedImpact,
          rootCauseCandidate: attack.description,
          executionClassification: "future_mock_runtime",
        })
      );
    }

    return { observations };
  }

  summarize(result: AISpecialistResult): string {
    if (result.status === "skipped") return result.eligibility.reason;
    if (result.status === "failed" || result.status === "timeout") {
      return result.failure?.message ?? `${this.name} did not complete.`;
    }
    const steps = result.plan?.validationSteps.length ?? 0;
    return `${this.name} ${result.status} — ${result.observations.length} observation(s), ${steps} validation step(s).`;
  }

  protected observation(
    partial: Omit<AISpecialistObservation, "id" | "specialistId">
  ): AISpecialistObservation {
    return {
      id: stableAiId(`obs:${this.id}:${partial.attackCaseId ?? partial.invariantId ?? partial.title}`),
      specialistId: this.id,
      ...partial,
    };
  }
}

function buildValidationSteps(input: {
  specialistId: string;
  invariants: AIInvariant[];
  attacks: AIAttackCase[];
  intentPrefix: string;
  graphNodeIds: string[];
}): { steps: AISpecialistValidationStep[]; truncated: boolean } {
  const steps: AISpecialistValidationStep[] = [];
  let order = 1;
  let truncated = false;

  const attacksByInv = new Map<string, AIAttackCase[]>();
  for (const a of input.attacks) {
    const list = attacksByInv.get(a.targetInvariantId) ?? [];
    list.push(a);
    attacksByInv.set(a.targetInvariantId, list);
  }

  for (const inv of input.invariants) {
    if (order > AI_SPECIALIST_MAX_VALIDATION_STEPS) {
      truncated = true;
      break;
    }
    const linked = attacksByInv.get(inv.id) ?? [];
    const attack = linked[0] ?? null;
    steps.push({
      id: stableAiId(`vstep:${input.specialistId}:${order}`),
      order,
      intent: `${input.intentPrefix}: ${inv.title}`,
      targetComponentNodeIds: inv.relationships.protectedComponentNodeIds,
      targetInvariantId: inv.id,
      targetAttackCaseId: attack?.id ?? null,
      targetTrustBoundaryId: inv.protectedTrustBoundaryId,
      validationMode: attack ? "future_mock_runtime" : "static_plan_only",
      expectedEvidenceRefIds: [
        ...inv.evidence.map((e) => e.id),
        ...(attack?.evidence.map((e) => e.id) ?? []),
      ],
    });
    order += 1;
  }

  for (const attack of input.attacks) {
    if (order > AI_SPECIALIST_MAX_VALIDATION_STEPS) {
      truncated = true;
      break;
    }
    if (steps.some((s) => s.targetAttackCaseId === attack.id)) continue;
    steps.push({
      id: stableAiId(`vstep:${input.specialistId}:${order}:${attack.id.slice(0, 8)}`),
      order,
      intent: `${input.intentPrefix}: ${attack.title}`,
      targetComponentNodeIds: attack.sequence.graphNodeIds,
      targetInvariantId: attack.targetInvariantId,
      targetAttackCaseId: attack.id,
      targetTrustBoundaryId: attack.targetTrustBoundaryId,
      validationMode: "future_mock_runtime",
      expectedEvidenceRefIds: attack.evidence.map((e) => e.id),
    });
    order += 1;
  }

  return { steps: steps.slice(0, AI_SPECIALIST_MAX_VALIDATION_STEPS), truncated };
}
