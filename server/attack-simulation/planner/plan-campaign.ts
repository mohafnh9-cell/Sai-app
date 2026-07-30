import { createHash } from "crypto";
import type { AttackCampaign } from "../contracts/attack-campaign";
import type { AttackHypothesis } from "../contracts/attack-hypothesis";
import type { AttackScenario } from "../contracts/attack-scenario";
import type { AttackAuthorizationRecord } from "@/server/ai-red-team/authorization/types";
import { planScenariosFromHypotheses } from "./plan-scenarios";
import {
  validateAttackPreconditions,
  type PreconditionValidationResult,
} from "../preconditions/validate-preconditions";
import { DEFAULT_ATTACK_STEP_TEMPLATE } from "../contracts/attack-execution-step";

export type PlannedExecutionBundle = {
  scenario: AttackScenario;
  attackerProfile: Record<string, unknown>;
  protectedAssets: Record<string, unknown>[];
  stepTemplate: typeof DEFAULT_ATTACK_STEP_TEMPLATE;
  planHashMaterial: {
    adapterId: string;
    hypothesisId: string;
    runtimeMode: string;
    commitSha: string;
  };
};

export type AttackCampaignPlan = {
  precondition: PreconditionValidationResult;
  plannedScenarioCount: number;
  skippedHypotheses: Array<{ hypothesisId: string; reason: string }>;
  executionBundles: PlannedExecutionBundle[];
};

export function buildPlanHash(material: PlannedExecutionBundle["planHashMaterial"]): string {
  return createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0, 32);
}

export function buildExecutionPlanForScenario(input: {
  scenario: AttackScenario;
  campaign: Pick<AttackCampaign, "commitSha" | "runtimeMode">;
}): PlannedExecutionBundle {
  const metadata = input.scenario.metadata ?? {};
  const attackerProfile =
    metadata.attackerProfile &&
    typeof metadata.attackerProfile === "object" &&
    !Array.isArray(metadata.attackerProfile)
      ? (metadata.attackerProfile as Record<string, unknown>)
      : { role: "simulated_attacker" };

  const protectedAssets =
    metadata.protectedAsset &&
    typeof metadata.protectedAsset === "object" &&
    !Array.isArray(metadata.protectedAsset)
      ? [metadata.protectedAsset as Record<string, unknown>]
      : [];

  return {
    scenario: input.scenario,
    attackerProfile,
    protectedAssets,
    stepTemplate: DEFAULT_ATTACK_STEP_TEMPLATE,
    planHashMaterial: {
      adapterId: input.scenario.adapterId,
      hypothesisId: input.scenario.hypothesisId,
      runtimeMode: input.campaign.runtimeMode,
      commitSha: input.campaign.commitSha,
    },
  };
}

export function planAttackCampaign(input: {
  campaign: AttackCampaign;
  hypotheses: AttackHypothesis[];
  authorization?: AttackAuthorizationRecord | null;
  targetUrl?: string | null;
  scenarios?: AttackScenario[];
}): AttackCampaignPlan {
  const precondition = validateAttackPreconditions({
    campaign: input.campaign,
    authorization: input.authorization,
    targetUrl: input.targetUrl,
  });

  if (!precondition.ok) {
    return {
      precondition,
      plannedScenarioCount: 0,
      skippedHypotheses: [],
      executionBundles: [],
    };
  }

  const { planned, skipped } = planScenariosFromHypotheses({
    campaignId: input.campaign.id,
    organizationId: input.campaign.organizationId,
    projectId: input.campaign.projectId,
    runtimeMode: input.campaign.runtimeMode,
    hypotheses: input.hypotheses,
  });

  const scenarios = input.scenarios ?? [];
  const executionBundles = scenarios.map((scenario) =>
    buildExecutionPlanForScenario({ scenario, campaign: input.campaign })
  );

  return {
    precondition,
    plannedScenarioCount: planned.length,
    skippedHypotheses: skipped,
    executionBundles,
  };
}

export function plannedScenarioInputsFromHypotheses(input: {
  campaign: AttackCampaign;
  hypotheses: AttackHypothesis[];
  authorization?: AttackAuthorizationRecord | null;
  targetUrl?: string | null;
}) {
  const precondition = validateAttackPreconditions({
    campaign: input.campaign,
    authorization: input.authorization,
    targetUrl: input.targetUrl,
  });
  if (!precondition.ok) {
    return { precondition, planned: [], skipped: [] as Array<{ hypothesisId: string; reason: string }> };
  }

  const { planned, skipped } = planScenariosFromHypotheses({
    campaignId: input.campaign.id,
    organizationId: input.campaign.organizationId,
    projectId: input.campaign.projectId,
    runtimeMode: input.campaign.runtimeMode,
    hypotheses: input.hypotheses,
  });

  return { precondition, planned, skipped };
}
