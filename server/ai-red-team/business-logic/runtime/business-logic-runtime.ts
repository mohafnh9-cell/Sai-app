import { randomUUID } from "node:crypto";
import type { BusinessDomainModel } from "../model/domain.types";
import type { BusinessLogicSpecialistContext } from "../specialists/specialist.types";
import { planBusinessLogicExecutions } from "./execution-planner";
import { validateExecutionResult } from "./execution-validator";
import { MockBusinessLogicSimulator } from "./mock-simulator";
import {
  DEFAULT_BUSINESS_LOGIC_RUNTIME_BUDGET,
  DEFAULT_BUSINESS_LOGIC_RUNTIME_LIMITS,
  DEFAULT_BUSINESS_LOGIC_RUNTIME_PROFILE,
} from "./runtime.config";
import { assertSafeBusinessLogicExecutionMode } from "./production-guard";
import type {
  BusinessLogicExecutionPlan,
  BusinessLogicExecutionResult,
  BusinessLogicExecutionSummary,
  BusinessLogicRuntimeBudget,
  BusinessLogicRuntimeProfile,
} from "./runtime.types";

function findInvariant(domain: BusinessDomainModel, id: string) {
  return domain.invariantCollection?.invariants.find((i) => i.id === id) ?? null;
}

function findAbuse(domain: BusinessDomainModel, id: string | null) {
  if (!id) return null;
  return domain.abuseCollection?.cases.find((c) => c.id === id) ?? null;
}

async function executePlan(input: {
  domain: BusinessDomainModel;
  plan: BusinessLogicExecutionPlan;
  limits: typeof DEFAULT_BUSINESS_LOGIC_RUNTIME_LIMITS;
}): Promise<BusinessLogicExecutionResult> {
  const startedAt = Date.now();
  const invariant = findInvariant(input.domain, input.plan.targetInvariantId);
  const abuseCase = findAbuse(input.domain, input.plan.targetAbuseCaseId);

  assertSafeBusinessLogicExecutionMode(input.plan.executionMode);

  if (!invariant) {
    return validateExecutionResult(
      {
        executionId: `exec-${input.plan.id}`,
        planId: input.plan.id,
        workflowId: input.plan.workflowId,
        specialistId: input.plan.specialistId,
        executionMode: input.plan.executionMode,
        status: "failed",
        classification: "rejected",
        confidence: "rejected",
        evidence: [],
        validatedTransitions: [],
        validatedAssumptions: [],
        rejectedAssumptions: [],
        violatedInvariantId: null,
        businessConsequence: null,
        failureReason: "missing_context",
        evaluationsUsed: 0,
        transitionsUsed: 0,
        durationMs: Date.now() - startedAt,
      },
      null,
      abuseCase
    );
  }

  if (input.plan.executionMode === "blocked" || input.plan.executionMode === "unsupported") {
    return validateExecutionResult(
      {
        executionId: `exec-${input.plan.id}`,
        planId: input.plan.id,
        workflowId: input.plan.workflowId,
        specialistId: input.plan.specialistId,
        executionMode: input.plan.executionMode,
        status: "blocked",
        classification: "blocked",
        confidence: "blocked",
        evidence: [],
        validatedTransitions: [],
        validatedAssumptions: input.plan.assumptions,
        rejectedAssumptions: [],
        violatedInvariantId: null,
        businessConsequence: null,
        failureReason: input.plan.executionMode,
        evaluationsUsed: 0,
        transitionsUsed: 0,
        durationMs: Date.now() - startedAt,
      },
      invariant,
      abuseCase
    );
  }

  const runMock =
    input.plan.executionMode === "mock_runtime" || input.plan.executionMode === "simulation_only";

  const mock = runMock
    ? MockBusinessLogicSimulator.simulate({
        domain: input.domain,
        plan: input.plan,
        invariant,
        abuseCase,
        maxTransitions: Math.min(input.plan.maxEvaluations, input.limits.perPlanMaxTransitions),
      })
    : {
        invariantViolated: false,
        businessConsequence: null,
        validatedTransitions: [],
        validatedAssumptions: input.plan.assumptions.slice(0, 3),
        rejectedAssumptions: [],
        evidence: invariant.evidence.map((e) => ({
          id: `static-${input.plan.id}-${e.id}`,
          source: "invariant" as const,
          detail: e.detail,
          confidence: e.confidence,
          refId: e.id,
        })),
        evaluationsUsed: 1,
        transitionsUsed: 0,
      };

  const base: BusinessLogicExecutionResult = {
    executionId: randomUUID(),
    planId: input.plan.id,
    workflowId: input.plan.workflowId,
    specialistId: input.plan.specialistId,
    executionMode: input.plan.executionMode,
    status: "completed",
    classification: "inconclusive",
    confidence: "inconclusive",
    evidence: mock.evidence,
    validatedTransitions: mock.validatedTransitions,
    validatedAssumptions: mock.validatedAssumptions,
    rejectedAssumptions: mock.rejectedAssumptions,
    violatedInvariantId: mock.invariantViolated ? invariant.id : null,
    businessConsequence: mock.businessConsequence,
    failureReason: null,
    evaluationsUsed: mock.evaluationsUsed,
    transitionsUsed: mock.transitionsUsed,
    durationMs: Date.now() - startedAt,
  };

  return validateExecutionResult(base, invariant, abuseCase);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runBusinessLogicRuntime(input: {
  context: BusinessLogicSpecialistContext;
  profile?: BusinessLogicRuntimeProfile;
  budget?: BusinessLogicRuntimeBudget;
  signal?: AbortSignal;
}): Promise<BusinessLogicExecutionSummary> {
  const profile = input.profile ?? DEFAULT_BUSINESS_LOGIC_RUNTIME_PROFILE;
  const budget = input.budget ?? DEFAULT_BUSINESS_LOGIC_RUNTIME_BUDGET;
  const limits = DEFAULT_BUSINESS_LOGIC_RUNTIME_LIMITS;
  const specialistSummary = input.context.domain.specialistExecution;

  if (!specialistSummary) {
    return {
      id: randomUUID(),
      generatedAt: new Date().toISOString(),
      profileId: profile.id,
      plansTotal: 0,
      plansCompleted: 0,
      plansFailed: 0,
      plansBlocked: 0,
      plansSkipped: 0,
      partialReason: "missing_context",
      budgetUsage: {
        plansExecuted: 0,
        evaluationsUsed: 0,
        runtimeMsUsed: 0,
        transitionsUsed: 0,
      },
      results: [],
    };
  }

  const allPlans = planBusinessLogicExecutions({
    domain: input.context.domain,
    specialistSummary,
    profile,
    limits,
  }).slice(0, budget.maxPlans);

  const results: BusinessLogicExecutionResult[] = [];
  const runtimeStarted = Date.now();
  let evaluationsUsed = 0;
  let transitionsUsed = 0;
  let partialReason: string | null = null;

  for (const plan of allPlans) {
    if (input.signal?.aborted) {
      partialReason = "aborted";
      break;
    }
    if (results.length >= budget.maxPlans) {
      partialReason = "budget_max_plans";
      break;
    }
    if (evaluationsUsed >= budget.maxEvaluations) {
      partialReason = "budget_max_evaluations";
      break;
    }
    if (Date.now() - runtimeStarted >= budget.maxRuntimeMs) {
      partialReason = "budget_max_runtime";
      break;
    }
    if (transitionsUsed >= budget.maxTransitions) {
      partialReason = "budget_max_transitions";
      break;
    }

    try {
      const result = await withTimeout(
        executePlan({ domain: input.context.domain, plan, limits }),
        plan.timeoutMs
      );
      evaluationsUsed += result.evaluationsUsed;
      transitionsUsed += result.transitionsUsed;
      results.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "runtime_exception";
      const isTimeout = message === "timeout";
      results.push(
        validateExecutionResult(
          {
            executionId: `exec-${plan.id}`,
            planId: plan.id,
            workflowId: plan.workflowId,
            specialistId: plan.specialistId,
            executionMode: plan.executionMode,
            status: isTimeout ? "timeout" : "failed",
            classification: "rejected",
            confidence: "rejected",
            evidence: [],
            validatedTransitions: [],
            validatedAssumptions: plan.assumptions,
            rejectedAssumptions: [],
            violatedInvariantId: null,
            businessConsequence: null,
            failureReason: isTimeout ? "timeout" : "runtime_exception",
            evaluationsUsed: 0,
            transitionsUsed: 0,
            durationMs: 0,
          },
          findInvariant(input.context.domain, plan.targetInvariantId),
          findAbuse(input.context.domain, plan.targetAbuseCaseId)
        )
      );
    }
  }

  return {
    id: randomUUID(),
    generatedAt: new Date().toISOString(),
    profileId: profile.id,
    plansTotal: allPlans.length,
    plansCompleted: results.filter((r) => r.status === "completed").length,
    plansFailed: results.filter((r) => r.status === "failed" || r.status === "timeout").length,
    plansBlocked: results.filter((r) => r.status === "blocked").length,
    plansSkipped: Math.max(0, allPlans.length - results.length),
    partialReason,
    budgetUsage: {
      plansExecuted: results.length,
      evaluationsUsed,
      runtimeMsUsed: Date.now() - runtimeStarted,
      transitionsUsed,
    },
    results,
  };
}

export const BusinessLogicRuntime = {
  run: runBusinessLogicRuntime,
  executePlan,
};
