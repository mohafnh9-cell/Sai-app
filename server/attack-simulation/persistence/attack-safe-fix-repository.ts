import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  attackSafeFixSchema,
  createAttackSafeFixInputSchema,
  type AttackSafeFix,
  type CreateAttackSafeFixInput,
} from "../contracts/attack-safe-fix";
import { mapAttackSafeFixRow } from "../persistence/mappers";
import { AttackSimulationRepositoryError } from "../persistence/campaign-repository";

export async function createAttackSafeFix(
  admin: SupabaseClient,
  input: CreateAttackSafeFixInput
): Promise<AttackSafeFix> {
  const parsed = createAttackSafeFixInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AttackSimulationRepositoryError(parsed.error.message, "validation");
  }

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("attack_simulation_safe_fixes")
    .insert({
      mitigation_id: parsed.data.mitigationId,
      finding_id: parsed.data.findingId,
      execution_id: parsed.data.executionId,
      campaign_id: parsed.data.campaignId,
      organization_id: parsed.data.organizationId,
      project_id: parsed.data.projectId,
      safe_fix_record_id: null,
      status: parsed.data.status,
      cursor_prompt: parsed.data.cursorPrompt,
      patch_proposal: parsed.data.patchProposal,
      pull_request_proposal: parsed.data.pullRequestProposal,
      required_tests: parsed.data.requiredTests,
      rollback_plan: parsed.data.rollbackPlan,
      affected_files: parsed.data.affectedFiles,
      confidence: parsed.data.confidence,
      implementation_risk: parsed.data.implementationRisk,
      estimated_loc: parsed.data.estimatedLoc,
      metadata: parsed.data.metadata ?? {},
      updated_at: now,
    })
    .select("*")
    .single();

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  return attackSafeFixSchema.parse(mapAttackSafeFixRow(data));
}

export async function getAttackSafeFixForFinding(
  admin: SupabaseClient,
  findingId: string,
  organizationId: string
): Promise<AttackSafeFix | null> {
  const { data, error } = await admin
    .from("attack_simulation_safe_fixes")
    .select("*")
    .eq("finding_id", findingId)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  if (!data) return null;
  return attackSafeFixSchema.parse(mapAttackSafeFixRow(data));
}

export async function linkAttackSafeFixRecord(
  admin: SupabaseClient,
  input: {
    attackSafeFixId: string;
    organizationId: string;
    safeFixRecordId: string;
  }
): Promise<AttackSafeFix> {
  const { data, error } = await admin
    .from("attack_simulation_safe_fixes")
    .update({
      safe_fix_record_id: input.safeFixRecordId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.attackSafeFixId)
    .eq("organization_id", input.organizationId)
    .select("*")
    .single();

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  return attackSafeFixSchema.parse(mapAttackSafeFixRow(data));
}
