import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttackAuthorizationRecord } from "@/server/ai-red-team/authorization/types";
import type { AttackCampaign } from "../contracts/attack-campaign";
import type { AttackHypothesis } from "../contracts/attack-hypothesis";
import type { AttackScenario } from "../contracts/attack-scenario";
import { buildExecutionPlanForScenario, buildPlanHash, plannedScenarioInputsFromHypotheses } from "../planner/plan-campaign";
import {
  createAttackScenario,
  AttackSimulationRepositoryError,
  updateCampaignAfterPlanning,
} from "../persistence/campaign-repository";
import {
  createAttackExecution,
  createAttackExecutionPlan,
  createDefaultExecutionSteps,
} from "../persistence/execution-repository";
import { appendAttackRuntimeEvent } from "../persistence/runtime-event-repository";

export type PlanAndPersistCampaignResult =
  | {
      ok: true;
      campaign: AttackCampaign;
      scenarios: AttackScenario[];
      skippedHypotheses: Array<{ hypothesisId: string; reason: string }>;
      executionIds: string[];
    }
  | {
      ok: false;
      failureCode: string;
      safeFailureMessage: string;
    };

export async function planAndPersistCampaignFromHypotheses(
  admin: SupabaseClient,
  input: {
    campaign: AttackCampaign;
    hypotheses: AttackHypothesis[];
    authorization?: AttackAuthorizationRecord | null;
    targetUrl?: string | null;
  }
): Promise<PlanAndPersistCampaignResult> {
  const { precondition, planned, skipped } = plannedScenarioInputsFromHypotheses(input);
  if (!precondition.ok) {
    await appendAttackRuntimeEvent(admin, {
      campaignId: input.campaign.id,
      executionId: null,
      stepId: null,
      organizationId: input.campaign.organizationId,
      projectId: input.campaign.projectId,
      correlationId: input.campaign.correlationId,
      eventType: "attack_failed",
      payload: {
        safeMessage: precondition.safeFailureMessage,
        metadata: { failureCode: precondition.failureCode, phase: "preconditions" },
      },
    }).catch(() => undefined);

    return {
      ok: false,
      failureCode: precondition.failureCode,
      safeFailureMessage: precondition.safeFailureMessage,
    };
  }

  if (planned.length === 0) {
    return {
      ok: false,
      failureCode: "NO_PLANNABLE_SCENARIOS",
      safeFailureMessage: "No attack scenarios could be planned for this campaign.",
    };
  }

  const scenarios: AttackScenario[] = [];
  const executionIds: string[] = [];

  try {
    for (const item of planned) {
      const scenario = await createAttackScenario(admin, item.scenarioInput);
      scenarios.push(scenario);

      const bundle = buildExecutionPlanForScenario({
        scenario,
        campaign: input.campaign,
      });

      const execution = await createAttackExecution(admin, {
        campaignId: input.campaign.id,
        scenarioId: scenario.id,
        scanId: input.campaign.scanId,
        scanJobId: input.campaign.scanJobId,
        projectId: input.campaign.projectId,
        organizationId: input.campaign.organizationId,
        commitSha: input.campaign.commitSha,
        runtimeMode: input.campaign.runtimeMode,
        attackerProfile: bundle.attackerProfile,
        protectedAssets: bundle.protectedAssets,
        correlationId: input.campaign.correlationId,
      });

      const steps = await createDefaultExecutionSteps(admin, {
        executionId: execution.id,
        campaignId: input.campaign.id,
        organizationId: input.campaign.organizationId,
        projectId: input.campaign.projectId,
      });

      await createAttackExecutionPlan(admin, {
        executionId: execution.id,
        campaignId: input.campaign.id,
        organizationId: input.campaign.organizationId,
        projectId: input.campaign.projectId,
        version: 1,
        stepIds: steps.map((step) => step.id),
        totalWeight: steps.reduce((sum, step) => sum + step.weight, 0),
        planHash: buildPlanHash(bundle.planHashMaterial),
        metadata: {
          adapterId: scenario.adapterId,
          hypothesisId: scenario.hypothesisId,
        },
      });

      executionIds.push(execution.id);
    }
  } catch (error) {
    const message =
      error instanceof AttackSimulationRepositoryError ? error.message : "Campaign planning failed";
    return {
      ok: false,
      failureCode: "PLAN_PERSIST_FAILED",
      safeFailureMessage: message,
    };
  }

  const campaign = await updateCampaignAfterPlanning(admin, {
    campaignId: input.campaign.id,
    organizationId: input.campaign.organizationId,
    totalScenarios: scenarios.length,
    totalExecutions: executionIds.length,
    status: "queued",
  });

  await appendAttackRuntimeEvent(admin, {
    campaignId: campaign.id,
    executionId: null,
    stepId: null,
    organizationId: campaign.organizationId,
    projectId: campaign.projectId,
    correlationId: campaign.correlationId,
    eventType: "attack_preconditions_validated",
    payload: { checks: precondition.checks.filter((check) => check.passed).map((check) => check.code) },
  });

  await appendAttackRuntimeEvent(admin, {
    campaignId: campaign.id,
    executionId: null,
    stepId: null,
    organizationId: campaign.organizationId,
    projectId: campaign.projectId,
    correlationId: campaign.correlationId,
    eventType: "attack_planned",
    payload: {
      scenarioCount: scenarios.length,
      executionCount: executionIds.length,
      skippedCount: skipped.length,
    },
  });

  return {
    ok: true,
    campaign,
    scenarios,
    skippedHypotheses: skipped,
    executionIds,
  };
}
