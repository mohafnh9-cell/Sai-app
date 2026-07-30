import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createProtectionVerificationInputSchema,
  protectionVerificationSchema,
  type CreateProtectionVerificationInput,
  type ProtectionVerification,
} from "../contracts/protection-verification";
import { mapProtectionVerificationRow } from "../persistence/mappers";
import { AttackSimulationRepositoryError } from "../persistence/campaign-repository";

export async function createProtectionVerification(
  admin: SupabaseClient,
  input: CreateProtectionVerificationInput
): Promise<ProtectionVerification> {
  const parsed = createProtectionVerificationInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AttackSimulationRepositoryError(parsed.error.message, "validation");
  }

  const verifiedAt = new Date().toISOString();
  const { data, error } = await admin
    .from("attack_simulation_protection_verifications")
    .insert({
      replay_id: parsed.data.replayId,
      campaign_id: parsed.data.campaignId,
      organization_id: parsed.data.organizationId,
      project_id: parsed.data.projectId,
      original_execution_id: parsed.data.originalExecutionId,
      replay_execution_id: parsed.data.replayExecutionId,
      finding_id: parsed.data.findingId ?? null,
      outcome: parsed.data.outcome,
      original_evidence_id: parsed.data.originalEvidenceId ?? null,
      replay_evidence_id: parsed.data.replayEvidenceId ?? null,
      comparison: parsed.data.comparison ?? {},
      verified_at: verifiedAt,
    })
    .select("*")
    .single();

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  return protectionVerificationSchema.parse(mapProtectionVerificationRow(data));
}

export async function getProtectionVerificationForReplay(
  admin: SupabaseClient,
  replayId: string,
  organizationId: string
): Promise<ProtectionVerification | null> {
  const { data, error } = await admin
    .from("attack_simulation_protection_verifications")
    .select("*")
    .eq("replay_id", replayId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  if (!data) return null;
  return protectionVerificationSchema.parse(mapProtectionVerificationRow(data));
}
