import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  attackMitigationSchema,
  createAttackMitigationInputSchema,
  type AttackMitigation,
  type CreateAttackMitigationInput,
} from "../contracts/attack-mitigation";
import { mapAttackMitigationRow } from "../persistence/mappers";
import { AttackSimulationRepositoryError } from "../persistence/campaign-repository";

export async function createAttackMitigation(
  admin: SupabaseClient,
  input: CreateAttackMitigationInput
): Promise<AttackMitigation> {
  const parsed = createAttackMitigationInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AttackSimulationRepositoryError(parsed.error.message, "validation");
  }

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("attack_simulation_mitigations")
    .insert({
      finding_id: parsed.data.findingId,
      execution_id: parsed.data.executionId,
      campaign_id: parsed.data.campaignId,
      organization_id: parsed.data.organizationId,
      project_id: parsed.data.projectId,
      plain_language_explanation: parsed.data.plainLanguageExplanation,
      root_cause: parsed.data.rootCause,
      recommended_protection: parsed.data.recommendedProtection,
      likely_affected_files: parsed.data.likelyAffectedFiles,
      implementation_steps: parsed.data.implementationSteps,
      implementation_risk: parsed.data.implementationRisk,
      safe_fix_confidence: parsed.data.safeFixConfidence,
      estimated_loc: parsed.data.estimatedLoc,
      rollback_guidance: parsed.data.rollbackGuidance,
      residual_risk: parsed.data.residualRisk,
      metadata: parsed.data.metadata ?? {},
      updated_at: now,
    })
    .select("*")
    .single();

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  return attackMitigationSchema.parse(mapAttackMitigationRow(data));
}

export async function getAttackMitigationForFinding(
  admin: SupabaseClient,
  findingId: string,
  organizationId: string
): Promise<AttackMitigation | null> {
  const { data, error } = await admin
    .from("attack_simulation_mitigations")
    .select("*")
    .eq("finding_id", findingId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  if (!data) return null;
  return attackMitigationSchema.parse(mapAttackMitigationRow(data));
}
