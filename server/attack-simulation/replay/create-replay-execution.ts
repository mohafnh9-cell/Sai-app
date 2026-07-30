import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttackExecution } from "../contracts/attack-execution";
import type { AttackScenario } from "../contracts/attack-scenario";
import type { AttackCampaign } from "../contracts/attack-campaign";
import { buildExecutionPlanForScenario, buildPlanHash } from "../planner/plan-campaign";
import {
  createAttackExecution,
  createAttackExecutionPlan,
  createDefaultExecutionSteps,
} from "../persistence/execution-repository";

export async function createReplayExecutionForOriginal(
  admin: SupabaseClient,
  input: {
    campaign: Pick<AttackCampaign, "id" | "commitSha" | "runtimeMode" | "scanId" | "scanJobId">;
    originalExecution: Pick<
      AttackExecution,
      | "id"
      | "organizationId"
      | "projectId"
      | "scenarioId"
      | "commitSha"
      | "runtimeMode"
      | "attackerProfile"
      | "protectedAssets"
      | "correlationId"
    >;
    scenario: AttackScenario;
  }
): Promise<AttackExecution> {
  const execution = await createAttackExecution(admin, {
    campaignId: input.campaign.id,
    scenarioId: input.originalExecution.scenarioId,
    scanId: input.campaign.scanId,
    scanJobId: input.campaign.scanJobId,
    projectId: input.originalExecution.projectId,
    organizationId: input.originalExecution.organizationId,
    commitSha: input.originalExecution.commitSha,
    runtimeMode: input.originalExecution.runtimeMode,
    attackerProfile: input.originalExecution.attackerProfile,
    protectedAssets: input.originalExecution.protectedAssets,
    correlationId: input.originalExecution.correlationId,
  });

  const steps = await createDefaultExecutionSteps(admin, {
    executionId: execution.id,
    campaignId: input.campaign.id,
    organizationId: input.originalExecution.organizationId,
    projectId: input.originalExecution.projectId,
  });

  const bundle = buildExecutionPlanForScenario({
    scenario: input.scenario,
    campaign: input.campaign,
  });

  await createAttackExecutionPlan(admin, {
    executionId: execution.id,
    campaignId: input.campaign.id,
    organizationId: input.originalExecution.organizationId,
    projectId: input.originalExecution.projectId,
    version: 1,
    stepIds: steps.map((step) => step.id),
    totalWeight: steps.reduce((sum, step) => sum + step.weight, 0),
    planHash: buildPlanHash(bundle.planHashMaterial),
    metadata: {
      adapterId: input.scenario.adapterId,
      hypothesisId: input.scenario.hypothesisId,
      replayOfExecutionId: input.originalExecution.id,
    },
  });

  return execution;
}
