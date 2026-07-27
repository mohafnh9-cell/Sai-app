import { stableAiId } from "../model/stable-id";
import type { AISpecialistRegistry } from "../registry/ai-specialist-registry";
import type {
  AISpecialistContext,
  AISpecialistExecutionSummary,
  AISpecialistResult,
  AISpecialistStatus,
} from "./specialist.types";
import { AI_SPECIALIST_REGISTRY_MAX_BUDGET_MS } from "./specialist.types";

export type SpecialistRunnerOptions = {
  maxRegistryBudgetMs?: number;
  perSpecialistTimeoutMs?: number;
  forceFailSpecialistIds?: string[];
};

export async function runAiSecuritySpecialists(input: {
  registry: AISpecialistRegistry;
  context: AISpecialistContext;
  options?: SpecialistRunnerOptions;
  signal?: AbortSignal;
}): Promise<AISpecialistExecutionSummary> {
  const results: AISpecialistResult[] = [];
  const explainability: string[] = [];
  let budgetConsumedMs = 0;
  const maxBudget = input.options?.maxRegistryBudgetMs ?? AI_SPECIALIST_REGISTRY_MAX_BUDGET_MS;

  for (const specialist of input.registry.listAll()) {
    if (input.signal?.aborted) break;
    if (budgetConsumedMs >= maxBudget) {
      results.push(skippedResult(specialist, "Registry budget exhausted — remaining specialists blocked."));
      explainability.push(`${specialist.id}: blocked (registry budget)`);
      continue;
    }

    const startedAt = Date.now();
    try {
      const eligibility = await specialist.canRun(input.context);
      if (!eligibility.eligible) {
        const skipped = skippedResult(specialist, eligibility.reason, eligibility);
        skipped.durationMs = Date.now() - startedAt;
        results.push(skipped);
        explainability.push(`${specialist.id}: skipped — ${eligibility.reason}`);
        budgetConsumedMs += skipped.durationMs;
        continue;
      }

      if (input.options?.forceFailSpecialistIds?.includes(specialist.id)) {
        throw new Error("forced specialist failure for isolation test");
      }

      const planPromise = specialist.plan(input.context);
      const timeoutMs = input.options?.perSpecialistTimeoutMs;
      const plan = timeoutMs
        ? await withTimeout(planPromise, timeoutMs, `${specialist.name} plan timeout`)
        : await planPromise;

      const analyzePromise = specialist.analyze(input.context, plan);
      const analyzed = timeoutMs
        ? await withTimeout(analyzePromise, timeoutMs, `${specialist.name} analyze timeout`)
        : await analyzePromise;

      let status: AISpecialistStatus = "completed";
      if (plan.truncatedByBudget) status = "partial";

      const draft: AISpecialistResult = {
        specialistId: specialist.id,
        specialistName: specialist.name,
        status,
        eligibility,
        plan,
        observations: analyzed.observations,
        failure: null,
        summary: "",
        durationMs: Date.now() - startedAt,
        metadata: {
          providerFamily: null,
          tags: ["slice5", "planning_only"],
          planningPass: "rt10_slice5",
        },
      };
      draft.summary = specialist.summarize(draft);
      results.push(draft);
      explainability.push(`${specialist.id}: ${status} — ${draft.observations.length} observations`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown specialist failure";
      const isTimeout = message.includes("timeout");
      const failed: AISpecialistResult = {
        specialistId: specialist.id,
        specialistName: specialist.name,
        status: isTimeout ? "timeout" : "failed",
        eligibility: {
          eligible: true,
          reason: `${specialist.name} encountered an error during planning/analysis.`,
          matchedComponentKinds: [],
          matchedNodeKinds: [],
          matchedBoundaryKinds: [],
          matchedArchitectures: [],
          matchedProviderFamilies: input.context.graph.context.providerFamilies,
          matchedInvariantCategories: [],
          matchedAttackCategories: [],
        },
        plan: null,
        observations: [],
        failure: {
          code: isTimeout ? "timeout" : "analyze_error",
          message,
        },
        summary: `${specialist.name} ${isTimeout ? "timed out" : "failed"}: ${message}`,
        durationMs: Date.now() - startedAt,
        metadata: {
          providerFamily: null,
          tags: ["slice5", "failure_isolated"],
          planningPass: "rt10_slice5",
        },
      };
      results.push(failed);
      explainability.push(`${specialist.id}: ${failed.status} (isolated)`);
    }

    budgetConsumedMs += results[results.length - 1]!.durationMs;
  }

  return {
    id: stableAiId(`specialist-run:${input.context.graph.id}`),
    generatedAt: new Date().toISOString(),
    executionGraphId: input.context.graph.id,
    specialistsTotal: results.length,
    specialistsCompleted: results.filter((r) => r.status === "completed").length,
    specialistsPartial: results.filter((r) => r.status === "partial").length,
    specialistsSkipped: results.filter((r) => r.status === "skipped" || r.status === "blocked").length,
    specialistsFailed: results.filter((r) => r.status === "failed" || r.status === "timeout").length,
    observationCount: results.reduce((n, r) => n + r.observations.length, 0),
    budgetConsumedMs,
    results,
    explainability,
  };
}

function skippedResult(
  specialist: { id: string; name: string },
  reason: string,
  eligibility?: AISpecialistResult["eligibility"]
): AISpecialistResult {
  const el =
    eligibility ??
    ({
      eligible: false,
      reason,
      matchedComponentKinds: [],
      matchedNodeKinds: [],
      matchedBoundaryKinds: [],
      matchedArchitectures: [],
      matchedProviderFamilies: [],
      matchedInvariantCategories: [],
      matchedAttackCategories: [],
    } as AISpecialistResult["eligibility"]);

  return {
    specialistId: specialist.id,
    specialistName: specialist.name,
    status: reason.includes("blocked") ? "blocked" : "skipped",
    eligibility: el,
    plan: null,
    observations: [],
    failure: null,
    summary: reason,
    durationMs: 0,
    metadata: {
      providerFamily: null,
      tags: ["slice5"],
      planningPass: "rt10_slice5",
    },
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const AISecuritySpecialistRunner = {
  run: runAiSecuritySpecialists,
};
