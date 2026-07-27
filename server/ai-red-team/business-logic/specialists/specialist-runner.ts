import { randomUUID } from "node:crypto";
import type { BusinessLogicSpecialistRegistry } from "../registry/business-logic-specialist-registry";
import type {
  BusinessLogicSpecialistContext,
  BusinessLogicSpecialistExecutionSummary,
  BusinessLogicSpecialistResult,
} from "./specialist.types";

export async function runBusinessLogicSpecialists(input: {
  registry: BusinessLogicSpecialistRegistry;
  context: BusinessLogicSpecialistContext;
  signal?: AbortSignal;
}): Promise<BusinessLogicSpecialistExecutionSummary> {
  const results: BusinessLogicSpecialistResult[] = [];

  for (const specialist of input.registry.listAll()) {
    if (input.signal?.aborted) break;

    const startedAt = Date.now();
    try {
      const eligibility = await specialist.canRun(input.context);
      if (!eligibility.eligible) {
        results.push({
          specialistId: specialist.id,
          specialistName: specialist.name,
          status: "skipped",
          eligibility,
          plan: null,
          observations: [],
          failure: null,
          summary: specialist.summarize({
            specialistId: specialist.id,
            specialistName: specialist.name,
            status: "skipped",
            eligibility,
            plan: null,
            observations: [],
            failure: null,
            summary: "",
            durationMs: Date.now() - startedAt,
          }),
          durationMs: Date.now() - startedAt,
        });
        continue;
      }

      const plan = await specialist.plan(input.context);
      const analyzed = await specialist.analyze(input.context, plan);
      const draft: BusinessLogicSpecialistResult = {
        specialistId: specialist.id,
        specialistName: specialist.name,
        status: "completed",
        eligibility,
        plan,
        observations: analyzed.observations,
        failure: null,
        summary: "",
        durationMs: Date.now() - startedAt,
      };
      draft.summary = specialist.summarize(draft);
      results.push(draft);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown specialist failure";
      const failed: BusinessLogicSpecialistResult = {
        specialistId: specialist.id,
        specialistName: specialist.name,
        status: "failed",
        eligibility: {
          eligible: true,
          reason: `${specialist.name} failed during analysis.`,
          matchedWorkflowKinds: [],
          matchedWorkflowIds: [],
        },
        plan: null,
        observations: [],
        failure: { code: "analyze_error", message },
        summary: `${specialist.name} failed: ${message}`,
        durationMs: Date.now() - startedAt,
      };
      results.push(failed);
    }
  }

  const observationCount = results.reduce((n, r) => n + r.observations.length, 0);

  return {
    id: randomUUID(),
    generatedAt: new Date().toISOString(),
    specialistsTotal: results.length,
    specialistsCompleted: results.filter((r) => r.status === "completed").length,
    specialistsSkipped: results.filter((r) => r.status === "skipped").length,
    specialistsFailed: results.filter((r) => r.status === "failed").length,
    observationCount,
    results,
  };
}

export const BusinessLogicSpecialistRunner = {
  run: runBusinessLogicSpecialists,
};
