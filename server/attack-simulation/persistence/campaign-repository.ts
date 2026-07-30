import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import {
  attackCampaignSchema,
  createAttackCampaignInputSchema,
  type AttackCampaign,
  type CreateAttackCampaignInput,
} from "../contracts/attack-campaign";
import {
  attackScenarioSchema,
  createAttackScenarioInputSchema,
  type AttackScenario,
  type CreateAttackScenarioInput,
} from "../contracts/attack-scenario";
import { calculateCampaignProgressFromSteps } from "../progress/calculate-progress";
import type { AttackExecutionStep } from "../contracts";
import {
  mapAttackCampaignRow,
  mapAttackScenarioRow,
  toAttackCampaignInsertRow,
} from "./mappers";
import { isInfrastructurePgCode } from "./database-errors";

export class AttackSimulationRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: "validation" | "not_found" | "conflict" | "database" | "infrastructure" = "database",
    readonly pgCode?: string
  ) {
    super(message);
    this.name = "AttackSimulationRepositoryError";
  }
}

function throwRepositoryDatabaseError(error: { code?: string; message?: string }): never {
  if (isInfrastructurePgCode(error.code)) {
    throw new AttackSimulationRepositoryError(error.message ?? "Infrastructure unavailable", "infrastructure", error.code);
  }
  throw new AttackSimulationRepositoryError(error.message ?? "Database error", "database", error.code);
}

export async function createAttackCampaign(
  admin: SupabaseClient,
  input: CreateAttackCampaignInput
): Promise<AttackCampaign> {
  const parsed = createAttackCampaignInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AttackSimulationRepositoryError(parsed.error.message, "validation");
  }

  const correlationId = parsed.data.correlationId ?? randomUUID();
  const { data, error } = await admin
    .from("attack_simulation_campaigns")
    .insert(
      toAttackCampaignInsertRow({
        ...parsed.data,
        correlationId,
      })
    )
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new AttackSimulationRepositoryError("Campaign already exists for scan", "conflict");
    }
    throw new AttackSimulationRepositoryError(error.message, "database");
  }

  const campaign = attackCampaignSchema.parse(mapAttackCampaignRow(data));
  return campaign;
}

export async function getAttackCampaignById(
  admin: SupabaseClient,
  campaignId: string,
  organizationId: string
): Promise<AttackCampaign | null> {
  const { data, error } = await admin
    .from("attack_simulation_campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throwRepositoryDatabaseError(error);
  if (!data) return null;
  return attackCampaignSchema.parse(mapAttackCampaignRow(data));
}

export async function getAttackCampaignByScanId(
  admin: SupabaseClient,
  scanId: string,
  organizationId: string
): Promise<AttackCampaign | null> {
  const { data, error } = await admin
    .from("attack_simulation_campaigns")
    .select("*")
    .eq("scan_id", scanId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throwRepositoryDatabaseError(error);
  if (!data) return null;
  return attackCampaignSchema.parse(mapAttackCampaignRow(data));
}

export async function updateAttackCampaignProgress(
  admin: SupabaseClient,
  input: {
    campaignId: string;
    organizationId: string;
    steps: ReadonlyArray<Pick<AttackExecutionStep, "weight" | "status" | "durationMs">>;
    status?: AttackCampaign["status"];
  }
): Promise<AttackCampaign> {
  const progress = calculateCampaignProgressFromSteps(input.steps);
  const patch: Record<string, unknown> = {
    progress_percent: progress.progressPercent,
    estimated_remaining_ms: progress.estimatedRemainingMs,
    updated_at: new Date().toISOString(),
  };
  if (input.status) patch.status = input.status;

  const { data, error } = await admin
    .from("attack_simulation_campaigns")
    .update(patch)
    .eq("id", input.campaignId)
    .eq("organization_id", input.organizationId)
    .select("*")
    .single();

  if (error) throwRepositoryDatabaseError(error);
  return attackCampaignSchema.parse(mapAttackCampaignRow(data));
}

export async function createAttackScenario(
  admin: SupabaseClient,
  input: CreateAttackScenarioInput
): Promise<AttackScenario> {
  const parsed = createAttackScenarioInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AttackSimulationRepositoryError(parsed.error.message, "validation");
  }

  const { data, error } = await admin
    .from("attack_simulation_scenarios")
    .insert({
      campaign_id: parsed.data.campaignId,
      organization_id: parsed.data.organizationId,
      project_id: parsed.data.projectId,
      hypothesis_id: parsed.data.hypothesisId,
      adapter_id: parsed.data.adapterId,
      category: parsed.data.category,
      title: parsed.data.title,
      description: parsed.data.description,
      sort_order: parsed.data.sortOrder,
      red_team_source: parsed.data.redTeamSource ?? null,
      metadata: parsed.data.metadata ?? {},
      status: "planned",
    })
    .select("*")
    .single();

  if (error) throwRepositoryDatabaseError(error);
  return attackScenarioSchema.parse(mapAttackScenarioRow(data));
}

export async function listAttackScenariosForCampaign(
  admin: SupabaseClient,
  campaignId: string,
  organizationId: string
): Promise<AttackScenario[]> {
  const { data, error } = await admin
    .from("attack_simulation_scenarios")
    .select("*")
    .eq("campaign_id", campaignId)
    .eq("organization_id", organizationId)
    .order("sort_order", { ascending: true });

  if (error) throwRepositoryDatabaseError(error);
  return (data ?? []).map((row) => attackScenarioSchema.parse(mapAttackScenarioRow(row)));
}

export async function updateCampaignAfterPlanning(
  admin: SupabaseClient,
  input: {
    campaignId: string;
    organizationId: string;
    totalScenarios: number;
    totalExecutions: number;
    status: AttackCampaign["status"];
  }
): Promise<AttackCampaign> {
  const { data, error } = await admin
    .from("attack_simulation_campaigns")
    .update({
      total_scenarios: input.totalScenarios,
      total_executions: input.totalExecutions,
      status: input.status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.campaignId)
    .eq("organization_id", input.organizationId)
    .select("*")
    .single();

  if (error) throwRepositoryDatabaseError(error);
  return attackCampaignSchema.parse(mapAttackCampaignRow(data));
}

export async function getAttackScenarioById(
  admin: SupabaseClient,
  scenarioId: string,
  organizationId: string
): Promise<AttackScenario | null> {
  const { data, error } = await admin
    .from("attack_simulation_scenarios")
    .select("*")
    .eq("id", scenarioId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throwRepositoryDatabaseError(error);
  if (!data) return null;
  return attackScenarioSchema.parse(mapAttackScenarioRow(data));
}

export async function listAttackCampaignsForProject(
  admin: SupabaseClient,
  input: { projectId: string; organizationId: string; limit?: number }
): Promise<AttackCampaign[]> {
  let query = admin
    .from("attack_simulation_campaigns")
    .select("*")
    .eq("project_id", input.projectId)
    .eq("organization_id", input.organizationId)
    .order("updated_at", { ascending: false });

  if (input.limit) {
    query = query.limit(input.limit);
  }

  const { data, error } = await query;
  if (error) throwRepositoryDatabaseError(error);
  return (data ?? []).map((row) => attackCampaignSchema.parse(mapAttackCampaignRow(row)));
}

export async function cancelAttackCampaignRecord(
  admin: SupabaseClient,
  input: { campaignId: string; organizationId: string }
): Promise<AttackCampaign> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("attack_simulation_campaigns")
    .update({
      status: "cancelled",
      cancelled_at: now,
      estimated_remaining_ms: 0,
      updated_at: now,
    })
    .eq("id", input.campaignId)
    .eq("organization_id", input.organizationId)
    .in("status", ["planned", "queued", "preparing", "running", "paused", "completing"])
    .select("*")
    .maybeSingle();

  if (error) throwRepositoryDatabaseError(error);
  if (!data) {
    const existing = await getAttackCampaignById(admin, input.campaignId, input.organizationId);
    if (!existing) throw new AttackSimulationRepositoryError("Campaign not found", "not_found");
    return existing;
  }
  return attackCampaignSchema.parse(mapAttackCampaignRow(data));
}

export async function updateAttackCampaignStatus(
  admin: SupabaseClient,
  input: {
    campaignId: string;
    organizationId: string;
    status: AttackCampaign["status"];
    startedAt?: string | null;
  }
): Promise<AttackCampaign> {
  const patch: Record<string, unknown> = {
    status: input.status,
    updated_at: new Date().toISOString(),
  };
  if (input.startedAt !== undefined) patch.started_at = input.startedAt;

  const { data, error } = await admin
    .from("attack_simulation_campaigns")
    .update(patch)
    .eq("id", input.campaignId)
    .eq("organization_id", input.organizationId)
    .select("*")
    .single();

  if (error) throwRepositoryDatabaseError(error);
  return attackCampaignSchema.parse(mapAttackCampaignRow(data));
}
