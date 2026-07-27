import { randomUUID } from "node:crypto";
import type {
  BusinessLogicSpecialist,
  BusinessLogicSpecialistContext,
  BusinessLogicSpecialistObservation,
  BusinessLogicSpecialistPlan,
  BusinessLogicSpecialistResult,
} from "./specialist.types";
import {
  buildSpecialistPlan,
  eligibilityFromWorkflows,
  selectAbuseCases,
  selectInvariants,
} from "./specialist-selection";

export abstract class BaseBusinessLogicSpecialist implements BusinessLogicSpecialist {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly priority: number;
  abstract readonly supportedWorkflowKinds: BusinessLogicSpecialist["supportedWorkflowKinds"];
  abstract readonly supportedInvariantCategories: BusinessLogicSpecialist["supportedInvariantCategories"];
  abstract readonly supportedAbuseCategories: BusinessLogicSpecialist["supportedAbuseCategories"];

  protected abstract intentPrefix: string;
  protected abstract defaultAssumptions: string[];

  canRun(context: BusinessLogicSpecialistContext) {
    return eligibilityFromWorkflows({
      context,
      kinds: this.supportedWorkflowKinds,
      specialistLabel: this.name,
    }).eligibility;
  }

  async plan(context: BusinessLogicSpecialistContext): Promise<BusinessLogicSpecialistPlan> {
    const { workflows, eligibility } = eligibilityFromWorkflows({
      context,
      kinds: this.supportedWorkflowKinds,
      specialistLabel: this.name,
    });
    const workflowIds = workflows.map((w) => w.id);
    const invariants = selectInvariants({
      context,
      workflowIds,
      categories: this.supportedInvariantCategories,
    });
    const abuseCases = selectAbuseCases({
      context,
      invariantIds: invariants.map((i) => i.id),
      categories: this.supportedAbuseCategories,
    });

    return buildSpecialistPlan({
      specialistId: this.id,
      context,
      workflowIds,
      invariants,
      abuseCases,
      intentPrefix: this.intentPrefix,
      selectionRationale: eligibility.reason,
      assumptions: this.defaultAssumptions,
    });
  }

  abstract analyze(
    context: BusinessLogicSpecialistContext,
    plan: BusinessLogicSpecialistPlan
  ): Promise<Pick<BusinessLogicSpecialistResult, "observations">>;

  summarize(result: BusinessLogicSpecialistResult): string {
    if (result.status === "skipped") return result.eligibility.reason;
    if (result.status === "failed") return result.summary || `${this.name} failed.`;
    const steps = result.plan?.boundedStepCount ?? 0;
    return `${this.name} completed — ${result.observations.length} observation(s), ${steps} planned validation step(s).`;
  }

  protected observation(
    partial: Omit<BusinessLogicSpecialistObservation, "id" | "specialistId">
  ): BusinessLogicSpecialistObservation {
    return {
      id: randomUUID(),
      specialistId: this.id,
      ...partial,
    };
  }
}
