import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttackCampaign } from "../contracts/attack-campaign";
import { getAttackCampaignByScanId } from "../persistence/campaign-repository";
import { listAttackExecutionsForCampaign } from "../persistence/execution-repository";
import {
  attackSimulationVerdictOverlaySchema,
  type AttackSimulationVerdictOverlay,
} from "./types";

async function countFindingsByOutcome(
  admin: SupabaseClient,
  input: { campaignId: string; organizationId: string }
): Promise<{ confirmed: number; notExploitable: number }> {
  const { data, error } = await admin
    .from("attack_simulation_findings")
    .select("outcome")
    .eq("campaign_id", input.campaignId)
    .eq("organization_id", input.organizationId);

  if (error || !data) return { confirmed: 0, notExploitable: 0 };

  let confirmed = 0;
  let notExploitable = 0;
  for (const row of data) {
    if (row.outcome === "confirmed") confirmed += 1;
    if (row.outcome === "not_exploitable") notExploitable += 1;
  }
  return { confirmed, notExploitable };
}

function headlineForOverlay(input: {
  campaign: Pick<AttackCampaign, "status" | "confirmedFindings" | "blockedExecutions">;
  stillVulnerable: number;
  protectedExecutions: number;
}): string {
  if (input.stillVulnerable > 0) {
    return `${input.stillVulnerable} simulated attack(s) remain exploitable after fix review.`;
  }
  if (input.protectedExecutions > 0) {
    return `${input.protectedExecutions} attack scenario(s) verified as protected.`;
  }
  if (input.campaign.confirmedFindings > 0) {
    return `${input.campaign.confirmedFindings} attack scenario(s) confirmed; replay verification pending.`;
  }
  if (input.campaign.blockedExecutions > 0) {
    return `${input.campaign.blockedExecutions} attack(s) blocked by Safe Runtime guards.`;
  }
  if (["running", "queued", "preparing"].includes(input.campaign.status)) {
    return "Attack simulation campaign is still running.";
  }
  return "Attack simulation completed without confirmed exploitable scenarios.";
}

export async function buildAttackSimulationVerdictOverlay(
  admin: SupabaseClient,
  input: { scanId: string; organizationId: string; projectId: string }
): Promise<AttackSimulationVerdictOverlay | null> {
  const campaign = await getAttackCampaignByScanId(admin, input.scanId, input.organizationId);
  if (!campaign || campaign.projectId !== input.projectId) return null;

  const executions = await listAttackExecutionsForCampaign(
    admin,
    campaign.id,
    input.organizationId
  );

  const protectedExecutions = executions.filter((execution) => execution.status === "protected").length;
  const stillVulnerableExecutions = executions.filter(
    (execution) => execution.status === "still_vulnerable"
  ).length;
  const pendingReplay = executions.filter((execution) =>
    ["fix_ready", "confirmed"].includes(execution.status)
  ).length;

  const findingCounts = await countFindingsByOutcome(admin, {
    campaignId: campaign.id,
    organizationId: input.organizationId,
  });

  const overlay = {
    campaignId: campaign.id,
    campaignStatus: campaign.status,
    totalExecutions: campaign.totalExecutions,
    confirmedFindings: Math.max(campaign.confirmedFindings, findingCounts.confirmed),
    notExploitableFindings: findingCounts.notExploitable,
    protectedExecutions,
    stillVulnerableExecutions,
    blockedExecutions: campaign.blockedExecutions,
    pendingReplay,
    headline: headlineForOverlay({
      campaign,
      stillVulnerable: stillVulnerableExecutions,
      protectedExecutions,
    }),
  };

  return attackSimulationVerdictOverlaySchema.parse(overlay);
}

export function applyAttackSimulationVerdictOverlay<
  T extends Record<string, unknown>,
>(verdict: T, overlay: AttackSimulationVerdictOverlay | null): T & {
  attackSimulation?: AttackSimulationVerdictOverlay;
} {
  if (!overlay) return verdict;
  return {
    ...verdict,
    attackSimulation: overlay,
  };
}
