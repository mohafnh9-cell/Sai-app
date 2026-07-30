import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  attackEvidenceSchema,
  createAttackEvidenceInputSchema,
  type AttackEvidence,
  type CreateAttackEvidenceInput,
} from "../contracts/attack-evidence";
import { mapAttackEvidenceRow } from "../persistence/mappers";
import { AttackSimulationRepositoryError } from "../persistence/campaign-repository";

export async function createAttackEvidence(
  admin: SupabaseClient,
  input: CreateAttackEvidenceInput
): Promise<AttackEvidence> {
  const parsed = createAttackEvidenceInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AttackSimulationRepositoryError(parsed.error.message, "validation");
  }

  const { data, error } = await admin
    .from("attack_simulation_evidence")
    .insert({
      execution_id: parsed.data.executionId,
      campaign_id: parsed.data.campaignId,
      scenario_id: parsed.data.scenarioId,
      organization_id: parsed.data.organizationId,
      project_id: parsed.data.projectId,
      commit_sha: parsed.data.commitSha,
      environment: parsed.data.environment,
      expected_behavior: parsed.data.expectedBehavior,
      observed_behavior: parsed.data.observedBehavior,
      redacted_request: parsed.data.redactedRequest,
      redacted_response: parsed.data.redactedResponse,
      status_code: parsed.data.statusCode,
      side_effects: parsed.data.sideEffects,
      preconditions: parsed.data.preconditions,
      attack_profile: parsed.data.attackProfile,
      protected_assets: parsed.data.protectedAssets,
      reproducibility: parsed.data.reproducibility,
      confidence: parsed.data.confidence,
      replay_instructions: parsed.data.replayInstructions,
      captured_at: parsed.data.capturedAt,
    })
    .select("*")
    .single();

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  return attackEvidenceSchema.parse(mapAttackEvidenceRow(data));
}

export async function getAttackEvidenceForExecution(
  admin: SupabaseClient,
  executionId: string,
  organizationId: string
): Promise<AttackEvidence | null> {
  const { data, error } = await admin
    .from("attack_simulation_evidence")
    .select("*")
    .eq("execution_id", executionId)
    .eq("organization_id", organizationId)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  if (!data) return null;
  return attackEvidenceSchema.parse(mapAttackEvidenceRow(data));
}

export async function listAttackEvidenceForCampaign(
  admin: SupabaseClient,
  campaignId: string,
  organizationId: string
): Promise<AttackEvidence[]> {
  const { data, error } = await admin
    .from("attack_simulation_evidence")
    .select("*")
    .eq("campaign_id", campaignId)
    .eq("organization_id", organizationId)
    .order("captured_at", { ascending: true });

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  return (data ?? []).map((row) => attackEvidenceSchema.parse(mapAttackEvidenceRow(row)));
}
