import { stableAiId } from "../model/stable-id";
import type { AIAttackCase } from "../attacks/attack.types";
import type { AIInvariant } from "../invariants/invariant.types";
import {
  DEFAULT_AI_RUNTIME_BUDGET,
  DEFAULT_AI_RUNTIME_LIMITS,
  DEFAULT_AI_RUNTIME_PROFILE,
} from "./runtime.config";
import { planAiExecutions } from "./execution-planner";
import { assertSafeAiExecutionMode, isSyntheticExecutionMode } from "./production-guard";
import { runSimulationEngine } from "./simulation-engines";
import { validateExecutionResult, classifyExecutionConfidence, maxRuntimeEvidenceConfidence } from "./execution-validator";
import type {
  AIRuntimeContext,
  AIRuntimeExecutionInput,
  AIRuntimeSummary,
  AIExecutionPlan,
  AIExecutionResult,
} from "./runtime.types";

function findInvariant(ctx: AIRuntimeContext, id: string): AIInvariant | null {
  return ctx.invariants.invariants.find((i) => i.id === id) ?? null;
}

function findAttack(ctx: AIRuntimeContext, id: string | null): AIAttackCase | null {
  if (!id) return null;
  return ctx.attacks.cases.find((c) => c.id === id) ?? null;
}

async function executePlan(input: {
  context: AIRuntimeContext;
  plan: AIExecutionPlan;
}): Promise<AIExecutionResult> {
  const startedAt = Date.now();
  const invariant = findInvariant(input.context, input.plan.targetInvariantId);
  const attack = findAttack(input.context, input.plan.targetAttackCaseId);

  if (!invariant) {
    return validateExecutionResult(
      {
        executionId: stableAiId(`exec:${input.plan.id}`),
        planId: input.plan.id,
        specialistId: input.plan.specialistId,
        attackCaseId: input.plan.targetAttackCaseId,
        invariantId: input.plan.targetInvariantId,
        executionMode: input.plan.executionMode,
        status: "failed",
        classification: "unsupported",
        confidence: "unsupported",
        evidence: [],
        executedSteps: [],
        violatedInvariantId: null,
        expectedImpact: null,
        failureCode: "invalid_plan",
        failureReason: "missing invariant",
        promptsUsed: 0,
        toolInvocationsUsed: 0,
        conversationsUsed: 0,
        simulationsUsed: 0,
        durationMs: Date.now() - startedAt,
      },
      null,
      attack
    );
  }

  for (const nodeId of input.plan.targetComponentNodeIds) {
    if (nodeId && !input.context.graph.nodes.some((n) => n.id === nodeId)) {
      return validateExecutionResult(
        {
          executionId: stableAiId(`exec:${input.plan.id}`),
          planId: input.plan.id,
          specialistId: input.plan.specialistId,
          attackCaseId: input.plan.targetAttackCaseId,
          invariantId: input.plan.targetInvariantId,
          executionMode: input.plan.executionMode,
          status: "failed",
          classification: "inconclusive",
          confidence: "inconclusive",
          evidence: [],
          executedSteps: [],
          violatedInvariantId: null,
          expectedImpact: null,
          failureCode: "graph_inconsistency",
          failureReason: `Unknown graph node in plan: ${nodeId}`,
          promptsUsed: 0,
          toolInvocationsUsed: 0,
          conversationsUsed: 0,
          simulationsUsed: 0,
          durationMs: Date.now() - startedAt,
        },
        invariant,
        attack
      );
    }
  }

  if (
    input.plan.executionMode === "blocked" ||
    input.plan.executionMode === "unsupported" ||
    input.plan.executionMode === "staging_candidate"
  ) {
    try {
      assertSafeAiExecutionMode(input.plan.executionMode);
    } catch (e) {
      const message = e instanceof Error ? e.message : "blocked";
      return validateExecutionResult(
        {
          executionId: stableAiId(`exec:${input.plan.id}`),
          planId: input.plan.id,
          specialistId: input.plan.specialistId,
          attackCaseId: input.plan.targetAttackCaseId,
          invariantId: input.plan.targetInvariantId,
          executionMode: "blocked",
          status: "blocked",
          classification: "blocked",
          confidence: "blocked",
          evidence: [],
          executedSteps: [],
          violatedInvariantId: null,
          expectedImpact: null,
          failureCode: "production_forbidden",
          failureReason: message,
          promptsUsed: 0,
          toolInvocationsUsed: 0,
          conversationsUsed: 0,
          simulationsUsed: 0,
          durationMs: Date.now() - startedAt,
        },
        invariant,
        attack
      );
    }
  }

  try {
    assertSafeAiExecutionMode(input.plan.executionMode);
  } catch (e) {
    const message = e instanceof Error ? e.message : "unsafe mode";
    return validateExecutionResult(
      {
        executionId: stableAiId(`exec:${input.plan.id}`),
        planId: input.plan.id,
        specialistId: input.plan.specialistId,
        attackCaseId: input.plan.targetAttackCaseId,
        invariantId: input.plan.targetInvariantId,
        executionMode: "blocked",
        status: "blocked",
        classification: "blocked",
        confidence: "blocked",
        evidence: [],
        executedSteps: [],
        violatedInvariantId: null,
        expectedImpact: null,
        failureCode: "production_forbidden",
        failureReason: message,
        promptsUsed: 0,
        toolInvocationsUsed: 0,
        conversationsUsed: 0,
        simulationsUsed: 0,
        durationMs: Date.now() - startedAt,
      },
      invariant,
      attack
    );
  }

  if (!isSyntheticExecutionMode(input.plan.executionMode)) {
    return validateExecutionResult(
      {
        executionId: stableAiId(`exec:${input.plan.id}`),
        planId: input.plan.id,
        specialistId: input.plan.specialistId,
        attackCaseId: input.plan.targetAttackCaseId,
        invariantId: input.plan.targetInvariantId,
        executionMode: input.plan.executionMode,
        status: "skipped",
        classification: "unsupported",
        confidence: "unsupported",
        evidence: [],
        executedSteps: [],
        violatedInvariantId: null,
        expectedImpact: null,
        failureCode: "unsupported_architecture",
        failureReason: "Non-synthetic execution mode",
        promptsUsed: 0,
        toolInvocationsUsed: 0,
        conversationsUsed: 0,
        simulationsUsed: 0,
        durationMs: Date.now() - startedAt,
      },
      invariant,
      attack
    );
  }

  const sim = runSimulationEngine({
    engine: input.plan.simulationEngine,
    mode: input.plan.executionMode,
    plan: input.plan,
    graph: input.context.graph,
    invariant,
    attack,
  });

  if (sim.blocked) {
    return validateExecutionResult(
      {
        executionId: stableAiId(`exec:${input.plan.id}`),
        planId: input.plan.id,
        specialistId: input.plan.specialistId,
        attackCaseId: input.plan.targetAttackCaseId,
        invariantId: input.plan.targetInvariantId,
        executionMode: "blocked",
        status: "blocked",
        classification: "blocked",
        confidence: "blocked",
        evidence: sim.evidence,
        executedSteps: sim.executedSteps,
        violatedInvariantId: null,
        expectedImpact: null,
        failureCode: "production_forbidden",
        failureReason: sim.blockReason,
        promptsUsed: sim.promptsUsed,
        toolInvocationsUsed: sim.toolInvocationsUsed,
        conversationsUsed: sim.conversationsUsed,
        simulationsUsed: sim.simulationsUsed,
        durationMs: Date.now() - startedAt,
      },
      invariant,
      attack
    );
  }

  if (sim.promptsUsed > input.plan.maxPromptCount) {
    return validateExecutionResult(
      {
        executionId: stableAiId(`exec:${input.plan.id}`),
        planId: input.plan.id,
        specialistId: input.plan.specialistId,
        attackCaseId: input.plan.targetAttackCaseId,
        invariantId: input.plan.targetInvariantId,
        executionMode: input.plan.executionMode,
        status: "budget_exceeded",
        classification: "inconclusive",
        confidence: "inconclusive",
        evidence: sim.evidence,
        executedSteps: sim.executedSteps,
        violatedInvariantId: sim.invariantViolated ? invariant.id : null,
        expectedImpact: sim.expectedImpact,
        failureCode: "budget_exhaustion",
        failureReason: "Prompt budget exceeded for plan",
        promptsUsed: sim.promptsUsed,
        toolInvocationsUsed: sim.toolInvocationsUsed,
        conversationsUsed: sim.conversationsUsed,
        simulationsUsed: sim.simulationsUsed,
        durationMs: Date.now() - startedAt,
      },
      invariant,
      attack
    );
  }

  const evidenceMax = maxRuntimeEvidenceConfidence(sim.evidence);
  const classification = classifyExecutionConfidence({
    invariantViolated: sim.invariantViolated,
    evidenceMax,
    blocked: false,
    simulationRan: sim.simulationsUsed > 0,
  });

  return validateExecutionResult(
    {
      executionId: stableAiId(`exec:${input.plan.id}`),
      planId: input.plan.id,
      specialistId: input.plan.specialistId,
      attackCaseId: input.plan.targetAttackCaseId,
      invariantId: input.plan.targetInvariantId,
      executionMode: input.plan.executionMode,
      status: "completed",
      classification,
      confidence: classification,
      evidence: sim.evidence,
      executedSteps: sim.executedSteps,
      violatedInvariantId: sim.invariantViolated ? invariant.id : null,
      expectedImpact: sim.expectedImpact,
      failureCode: null,
      failureReason: null,
      promptsUsed: sim.promptsUsed,
      toolInvocationsUsed: sim.toolInvocationsUsed,
      conversationsUsed: sim.conversationsUsed,
      simulationsUsed: sim.simulationsUsed,
      durationMs: Date.now() - startedAt,
    },
    invariant,
    attack
  );
}

export async function runAiSafeRuntime(input: AIRuntimeExecutionInput): Promise<AIRuntimeSummary> {
  const profile = input.context.profile ?? DEFAULT_AI_RUNTIME_PROFILE;
  const budget = input.context.budget ?? DEFAULT_AI_RUNTIME_BUDGET;
  const limits = input.context.limits ?? DEFAULT_AI_RUNTIME_LIMITS;

  const plans = input.plans ?? planAiExecutions(input.context);
  const results: AIExecutionResult[] = [];
  const usage = {
    plansExecuted: 0,
    promptsUsed: 0,
    toolInvocationsUsed: 0,
    runtimeMsUsed: 0,
    simulationsUsed: 0,
  };

  const runStarted = Date.now();
  let partialReason: string | null = null;

  for (const plan of plans) {
    if (usage.runtimeMsUsed >= budget.maxRuntimeMs) {
      partialReason = "Registry runtime budget exhausted";
      break;
    }
    if (usage.plansExecuted >= budget.maxPlans) break;
    if (usage.promptsUsed >= budget.maxPrompts) {
      partialReason = "Prompt budget exhausted";
      break;
    }
    if (usage.simulationsUsed >= budget.maxSimulations) {
      partialReason = "Simulation budget exhausted";
      break;
    }

    const planStarted = Date.now();
    try {
      const timeoutMs = Math.min(plan.maxRuntimeMs, limits.perPlanTimeoutMs);
      const result = await withTimeout(
        executePlan({ context: input.context, plan }),
        timeoutMs,
        `Plan ${plan.id} timeout`
      );
      results.push(result);
      usage.plansExecuted += 1;
      usage.promptsUsed += result.promptsUsed;
      usage.toolInvocationsUsed += result.toolInvocationsUsed;
      usage.simulationsUsed += result.simulationsUsed;
      usage.runtimeMsUsed += result.durationMs;
    } catch (error) {
      const message = error instanceof Error ? error.message : "simulation failure";
      const isTimeout = message.includes("timeout");
      results.push({
        executionId: stableAiId(`exec-fail:${plan.id}`),
        planId: plan.id,
        specialistId: plan.specialistId,
        attackCaseId: plan.targetAttackCaseId,
        invariantId: plan.targetInvariantId,
        executionMode: plan.executionMode,
        status: isTimeout ? "timeout" : "failed",
        classification: "inconclusive",
        confidence: "inconclusive",
        evidence: [],
        executedSteps: [],
        violatedInvariantId: null,
        expectedImpact: null,
        failureCode: isTimeout ? "timeout" : "simulation_failure",
        failureReason: message,
        promptsUsed: 0,
        toolInvocationsUsed: 0,
        conversationsUsed: 0,
        simulationsUsed: 0,
        durationMs: Date.now() - planStarted,
      });
      usage.plansExecuted += 1;
      usage.runtimeMsUsed += Date.now() - planStarted;
    }
  }

  const promptCount = results.reduce((n, r) => n + r.promptsUsed, 0);
  const toolCount = results.reduce((n, r) => n + r.toolInvocationsUsed, 0);
  const conversationCount = results.reduce((n, r) => n + r.conversationsUsed, 0);
  const simulationCount = results.reduce((n, r) => n + r.simulationsUsed, 0);

  return {
    id: stableAiId(`rt-summary:${input.context.graph.id}`),
    generatedAt: new Date().toISOString(),
    profileId: profile.id,
    executionGraphId: input.context.graph.id,
    plansTotal: plans.length,
    plansCompleted: results.filter((r) => r.status === "completed").length,
    plansPartial: partialReason ? 1 : 0,
    plansFailed: results.filter((r) => r.status === "failed").length,
    plansBlocked: results.filter((r) => r.status === "blocked").length,
    plansSkipped: results.filter((r) => r.status === "skipped").length,
    plansTimeout: results.filter((r) => r.status === "timeout").length,
    promptCount,
    toolCount,
    conversationCount,
    executionDurationMs: Date.now() - runStarted,
    runtimeBudgetMs: budget.maxRuntimeMs,
    simulationCount,
    skippedExecutions: results.filter((r) => r.status === "skipped").length,
    blockedExecutions: results.filter((r) => r.status === "blocked").length,
    failedExecutions: results.filter((r) => r.status === "failed" || r.status === "timeout").length,
    budgetUsage: usage,
    partialReason,
    results,
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

export const AIRuntime = {
  run: runAiSafeRuntime,
  planExecutions: planAiExecutions,
};

export const AIRuntimeCoordinator = {
  runSafeRuntime: runAiSafeRuntime,
};
