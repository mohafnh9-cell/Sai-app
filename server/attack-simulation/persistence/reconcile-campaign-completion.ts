import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttackCampaign } from "../contracts/attack-campaign";
import {
  TERMINAL_ATTACK_CAMPAIGN_STATUSES,
  TERMINAL_ATTACK_EXECUTION_STATUSES,
} from "../contracts/enums";
import { getAttackCampaignById } from "./campaign-repository";
import { listAttackExecutionsForCampaign } from "./execution-repository";
import { mapAttackCampaignRow } from "./mappers";
import { attackCampaignSchema } from "../contracts/attack-campaign";

/**
 * Mark campaign completed when every execution has reached a terminal state.
 */
export async function reconcileAttackCampaignCompletion(
  admin: SupabaseClient,
  input: { campaignId: string; organizationId: string }
): Promise<AttackCampaign | null> {
  const campaign = await getAttackCampaignById(admin, input.campaignId, input.organizationId);
  if (!campaign) return null;

  if (TERMINAL_ATTACK_CAMPAIGN_STATUSES.has(campaign.status)) {
    return campaign;
  }

  const executions = await listAttackExecutionsForCampaign(
    admin,
    input.campaignId,
    input.organizationId
  );
  if (executions.length === 0) return campaign;

  const allTerminal = executions.every((execution) =>
    TERMINAL_ATTACK_EXECUTION_STATUSES.has(execution.status)
  );
  if (!allTerminal) return campaign;

  const completedExecutions = executions.filter((execution) =>
    TERMINAL_ATTACK_EXECUTION_STATUSES.has(execution.status)
  ).length;
  const allFailed = executions.every(
    (execution) => execution.status === "failed" || execution.status === "blocked"
  );
  const finalStatus = allFailed ? "failed" : "completed";
  const now = new Date().toISOString();

  const { data, error } = await admin
    .from("attack_simulation_campaigns")
    .update({
      status: finalStatus,
      completed_executions: completedExecutions,
      progress_percent: 100,
      estimated_remaining_ms: 0,
      completed_at: now,
      updated_at: now,
    })
    .eq("id", input.campaignId)
    .eq("organization_id", input.organizationId)
    .in("status", ["planned", "queued", "preparing", "running", "paused", "completing"])
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Could not reconcile campaign completion: ${error.message}`);
  }

  if (!data) {
    return getAttackCampaignById(admin, input.campaignId, input.organizationId);
  }

  return attackCampaignSchema.parse(mapAttackCampaignRow(data));
}
