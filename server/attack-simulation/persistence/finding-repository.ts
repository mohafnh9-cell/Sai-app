import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  attackFindingSchema,
  createAttackFindingInputSchema,
  type AttackFinding,
  type CreateAttackFindingInput,
} from "../contracts/attack-finding";
import { mapAttackFindingRow } from "../persistence/mappers";
import { AttackSimulationRepositoryError } from "../persistence/campaign-repository";

export async function createAttackFinding(
  admin: SupabaseClient,
  input: CreateAttackFindingInput
): Promise<AttackFinding> {
  const parsed = createAttackFindingInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AttackSimulationRepositoryError(parsed.error.message, "validation");
  }

  const now = new Date().toISOString();
  const confirmedAt = parsed.data.outcome === "confirmed" ? now : null;

  const { data, error } = await admin
    .from("attack_simulation_findings")
    .insert({
      execution_id: parsed.data.executionId,
      campaign_id: parsed.data.campaignId,
      scenario_id: parsed.data.scenarioId,
      organization_id: parsed.data.organizationId,
      project_id: parsed.data.projectId,
      evidence_id: parsed.data.evidenceId,
      title: parsed.data.title,
      description: parsed.data.description,
      category: parsed.data.category,
      severity: parsed.data.severity,
      confidence: parsed.data.confidence,
      outcome: parsed.data.outcome,
      impact: parsed.data.impact,
      root_cause: parsed.data.rootCause,
      metadata: parsed.data.metadata ?? {},
      confirmed_at: confirmedAt,
      updated_at: now,
    })
    .select("*")
    .single();

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  return attackFindingSchema.parse(mapAttackFindingRow(data));
}

export async function getAttackFindingById(
  admin: SupabaseClient,
  findingId: string,
  organizationId: string
): Promise<AttackFinding | null> {
  const { data, error } = await admin
    .from("attack_simulation_findings")
    .select("*")
    .eq("id", findingId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  if (!data) return null;
  return attackFindingSchema.parse(mapAttackFindingRow(data));
}

export async function listAttackFindingsForExecutions(
  admin: SupabaseClient,
  executionIds: string[],
  organizationId: string
): Promise<Map<string, AttackFinding>> {
  if (executionIds.length === 0) return new Map();

  const { data, error } = await admin
    .from("attack_simulation_findings")
    .select("*")
    .in("execution_id", executionIds)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");

  const byExecution = new Map<string, AttackFinding>();
  for (const row of data ?? []) {
    const finding = attackFindingSchema.parse(mapAttackFindingRow(row));
    if (!byExecution.has(finding.executionId)) {
      byExecution.set(finding.executionId, finding);
    }
  }
  return byExecution;
}

export async function getAttackFindingForExecution(
  admin: SupabaseClient,
  executionId: string,
  organizationId: string
): Promise<AttackFinding | null> {
  const { data, error } = await admin
    .from("attack_simulation_findings")
    .select("*")
    .eq("execution_id", executionId)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  if (!data) return null;
  return attackFindingSchema.parse(mapAttackFindingRow(data));
}
