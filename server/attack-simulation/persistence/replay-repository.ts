import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  attackReplaySchema,
  createAttackReplayInputSchema,
  type AttackReplay,
  type CreateAttackReplayInput,
} from "../contracts/attack-replay";
import { mapAttackReplayRow } from "../persistence/mappers";
import { AttackSimulationRepositoryError } from "../persistence/campaign-repository";

export async function createAttackReplay(
  admin: SupabaseClient,
  input: CreateAttackReplayInput & { startedAt?: string }
): Promise<AttackReplay> {
  const parsed = createAttackReplayInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AttackSimulationRepositoryError(parsed.error.message, "validation");
  }

  const startedAt = input.startedAt ?? new Date().toISOString();
  const { data, error } = await admin
    .from("attack_simulation_replays")
    .insert({
      campaign_id: parsed.data.campaignId,
      organization_id: parsed.data.organizationId,
      project_id: parsed.data.projectId,
      original_execution_id: parsed.data.originalExecutionId,
      replay_execution_id: parsed.data.replayExecutionId,
      finding_id: parsed.data.findingId ?? null,
      safe_fix_id: parsed.data.safeFixId ?? null,
      started_at: startedAt,
    })
    .select("*")
    .single();

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  return attackReplaySchema.parse(mapAttackReplayRow(data));
}

export async function completeAttackReplay(
  admin: SupabaseClient,
  input: {
    replayId: string;
    organizationId: string;
    completedAt?: string;
  }
): Promise<AttackReplay> {
  const completedAt = input.completedAt ?? new Date().toISOString();
  const { data, error } = await admin
    .from("attack_simulation_replays")
    .update({ completed_at: completedAt })
    .eq("id", input.replayId)
    .eq("organization_id", input.organizationId)
    .select("*")
    .single();

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  return attackReplaySchema.parse(mapAttackReplayRow(data));
}

export async function getLatestAttackReplayForExecution(
  admin: SupabaseClient,
  originalExecutionId: string,
  organizationId: string
): Promise<AttackReplay | null> {
  const { data, error } = await admin
    .from("attack_simulation_replays")
    .select("*")
    .eq("original_execution_id", originalExecutionId)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  if (!data) return null;
  return attackReplaySchema.parse(mapAttackReplayRow(data));
}
