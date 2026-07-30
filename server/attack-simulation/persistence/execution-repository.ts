import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import {
  attackExecutionSchema,
  createAttackExecutionInputSchema,
  type AttackExecution,
  type CreateAttackExecutionInput,
} from "../contracts/attack-execution";
import {
  attackExecutionStepSchema,
  createAttackExecutionStepInputSchema,
  DEFAULT_ATTACK_STEP_TEMPLATE,
  type AttackExecutionStep,
  type CreateAttackExecutionStepInput,
} from "../contracts/attack-execution-step";
import {
  attackExecutionPlanSchema,
  createAttackExecutionPlanInputSchema,
  type AttackExecutionPlan,
  type CreateAttackExecutionPlanInput,
} from "../contracts/attack-execution-plan";
import type { AttackExecutionStatus } from "../contracts/enums";
import type { AttackExecutionStepStatus } from "../contracts/attack-execution-step";
import {
  assertStepWeightsValid,
  calculateElapsedMs,
  calculateProgressFromSteps,
} from "../progress/calculate-progress";
import {
  mapAttackExecutionPlanRow,
  mapAttackExecutionRow,
  mapAttackExecutionStepRow,
} from "./mappers";
import { AttackSimulationRepositoryError } from "./campaign-repository";

export async function createAttackExecution(
  admin: SupabaseClient,
  input: CreateAttackExecutionInput
): Promise<AttackExecution> {
  const parsed = createAttackExecutionInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AttackSimulationRepositoryError(parsed.error.message, "validation");
  }

  const correlationId = parsed.data.correlationId ?? randomUUID();
  const { data, error } = await admin
    .from("attack_simulation_executions")
    .insert({
      campaign_id: parsed.data.campaignId,
      scenario_id: parsed.data.scenarioId,
      scan_id: parsed.data.scanId,
      scan_job_id: parsed.data.scanJobId,
      project_id: parsed.data.projectId,
      organization_id: parsed.data.organizationId,
      commit_sha: parsed.data.commitSha,
      runtime_mode: parsed.data.runtimeMode,
      correlation_id: correlationId,
      attacker_profile: parsed.data.attackerProfile,
      protected_assets: parsed.data.protectedAssets,
      status: "planned",
      current_stage: "planned",
      progress_percent: 0,
      estimated_remaining_ms: null,
      elapsed_ms: 0,
    })
    .select("*")
    .single();

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  return attackExecutionSchema.parse(mapAttackExecutionRow(data));
}

export async function createDefaultExecutionSteps(
  admin: SupabaseClient,
  input: {
    executionId: string;
    campaignId: string;
    organizationId: string;
    projectId: string;
  }
): Promise<AttackExecutionStep[]> {
  const steps: AttackExecutionStep[] = [];
  for (const template of DEFAULT_ATTACK_STEP_TEMPLATE) {
    const stepInput: CreateAttackExecutionStepInput = {
      executionId: input.executionId,
      campaignId: input.campaignId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      sortOrder: template.sortOrder,
      kind: template.kind,
      label: template.label,
      weight: template.weight,
      metadata: {},
    };
    const parsed = createAttackExecutionStepInputSchema.safeParse(stepInput);
    if (!parsed.success) {
      throw new AttackSimulationRepositoryError(parsed.error.message, "validation");
    }

    const { data, error } = await admin
      .from("attack_simulation_execution_steps")
      .insert({
        execution_id: parsed.data.executionId,
        campaign_id: parsed.data.campaignId,
        organization_id: parsed.data.organizationId,
        project_id: parsed.data.projectId,
        sort_order: parsed.data.sortOrder,
        kind: parsed.data.kind,
        label: parsed.data.label,
        weight: parsed.data.weight,
        metadata: parsed.data.metadata ?? {},
        status: "pending",
      })
      .select("*")
      .single();

    if (error) throw new AttackSimulationRepositoryError(error.message, "database");
    steps.push(attackExecutionStepSchema.parse(mapAttackExecutionStepRow(data)));
  }

  assertStepWeightsValid(steps);
  return steps;
}

export async function createAttackExecutionPlan(
  admin: SupabaseClient,
  input: CreateAttackExecutionPlanInput
): Promise<AttackExecutionPlan> {
  const parsed = createAttackExecutionPlanInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AttackSimulationRepositoryError(parsed.error.message, "validation");
  }

  const { data, error } = await admin
    .from("attack_simulation_execution_plans")
    .insert({
      execution_id: parsed.data.executionId,
      campaign_id: parsed.data.campaignId,
      organization_id: parsed.data.organizationId,
      project_id: parsed.data.projectId,
      version: parsed.data.version,
      step_ids: parsed.data.stepIds,
      total_weight: parsed.data.totalWeight,
      plan_hash: parsed.data.planHash,
      metadata: parsed.data.metadata ?? {},
    })
    .select("*")
    .single();

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  return attackExecutionPlanSchema.parse(mapAttackExecutionPlanRow(data));
}

export async function listAttackExecutionSteps(
  admin: SupabaseClient,
  executionId: string,
  organizationId: string
): Promise<AttackExecutionStep[]> {
  const { data, error } = await admin
    .from("attack_simulation_execution_steps")
    .select("*")
    .eq("execution_id", executionId)
    .eq("organization_id", organizationId)
    .order("sort_order", { ascending: true });

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  return (data ?? []).map((row) => attackExecutionStepSchema.parse(mapAttackExecutionStepRow(row)));
}

export async function updateAttackExecutionProgressFromSteps(
  admin: SupabaseClient,
  input: {
    executionId: string;
    organizationId: string;
    steps: AttackExecutionStep[];
    status?: AttackExecution["status"];
    currentStage?: AttackExecution["currentStage"];
    currentStepId?: string | null;
    currentStepTitle?: string | null;
    startedAt?: string | null;
  }
): Promise<AttackExecution> {
  const progress = calculateProgressFromSteps(input.steps);
  const { data: existing, error: readError } = await admin
    .from("attack_simulation_executions")
    .select("started_at")
    .eq("id", input.executionId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  if (readError) throw new AttackSimulationRepositoryError(readError.message, "database");
  if (!existing) throw new AttackSimulationRepositoryError("Execution not found", "not_found");

  const startedAt = input.startedAt ?? (existing.started_at as string | null);
  const patch: Record<string, unknown> = {
    progress_percent: progress.progressPercent,
    estimated_remaining_ms: progress.estimatedRemainingMs,
    elapsed_ms: calculateElapsedMs(startedAt),
    updated_at: new Date().toISOString(),
  };
  if (input.status) patch.status = input.status;
  if (input.currentStage) patch.current_stage = input.currentStage;
  if (input.currentStepId !== undefined) patch.current_step_id = input.currentStepId;
  if (input.currentStepTitle !== undefined) patch.current_step_title = input.currentStepTitle;

  const { data, error } = await admin
    .from("attack_simulation_executions")
    .update(patch)
    .eq("id", input.executionId)
    .eq("organization_id", input.organizationId)
    .select("*")
    .single();

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  return attackExecutionSchema.parse(mapAttackExecutionRow(data));
}

export async function getAttackExecutionById(
  admin: SupabaseClient,
  executionId: string,
  organizationId: string
): Promise<AttackExecution | null> {
  const { data, error } = await admin
    .from("attack_simulation_executions")
    .select("*")
    .eq("id", executionId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  if (!data) return null;
  return attackExecutionSchema.parse(mapAttackExecutionRow(data));
}

export async function listAttackExecutionsForCampaign(
  admin: SupabaseClient,
  campaignId: string,
  organizationId: string
): Promise<AttackExecution[]> {
  const { data, error } = await admin
    .from("attack_simulation_executions")
    .select("*")
    .eq("campaign_id", campaignId)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  return (data ?? []).map((row) => attackExecutionSchema.parse(mapAttackExecutionRow(row)));
}

export async function listAttackExecutionStepsForCampaign(
  admin: SupabaseClient,
  campaignId: string,
  organizationId: string
): Promise<AttackExecutionStep[]> {
  const { data, error } = await admin
    .from("attack_simulation_execution_steps")
    .select("*")
    .eq("campaign_id", campaignId)
    .eq("organization_id", organizationId)
    .order("execution_id", { ascending: true })
    .order("sort_order", { ascending: true });

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  return (data ?? []).map((row) => attackExecutionStepSchema.parse(mapAttackExecutionStepRow(row)));
}

export async function updateAttackExecutionStepStatus(
  admin: SupabaseClient,
  input: {
    stepId: string;
    organizationId: string;
    status: AttackExecutionStepStatus;
    startedAt?: string | null;
    completedAt?: string | null;
    durationMs?: number | null;
    failureCode?: string | null;
  }
): Promise<AttackExecutionStep> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: input.status,
    updated_at: now,
  };
  if (input.startedAt !== undefined) patch.started_at = input.startedAt;
  if (input.completedAt !== undefined) patch.completed_at = input.completedAt;
  if (input.durationMs !== undefined) patch.duration_ms = input.durationMs;
  if (input.failureCode !== undefined) patch.failure_code = input.failureCode;

  const { data, error } = await admin
    .from("attack_simulation_execution_steps")
    .update(patch)
    .eq("id", input.stepId)
    .eq("organization_id", input.organizationId)
    .select("*")
    .single();

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  return attackExecutionStepSchema.parse(mapAttackExecutionStepRow(data));
}

export async function finalizeAttackExecution(
  admin: SupabaseClient,
  input: {
    executionId: string;
    organizationId: string;
    status: AttackExecutionStatus;
    currentStage: AttackExecutionStatus;
    failureCode?: string | null;
    safeFailureMessage?: string | null;
    completedAt?: string | null;
    cancelledAt?: string | null;
  }
): Promise<AttackExecution> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: input.status,
    current_stage: input.currentStage,
    failure_code: input.failureCode ?? null,
    safe_failure_message: input.safeFailureMessage ?? null,
    completed_at: input.completedAt ?? null,
    cancelled_at: input.cancelledAt ?? null,
    updated_at: now,
  };
  if (input.status === "completed") {
    patch.progress_percent = 100;
    patch.estimated_remaining_ms = 0;
  } else if (["failed", "blocked", "cancelled"].includes(input.status)) {
    patch.estimated_remaining_ms = 0;
  }

  const { data, error } = await admin
    .from("attack_simulation_executions")
    .update(patch)
    .eq("id", input.executionId)
    .eq("organization_id", input.organizationId)
    .select("*")
    .single();

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  return attackExecutionSchema.parse(mapAttackExecutionRow(data));
}

export async function markAttackExecutionRunning(
  admin: SupabaseClient,
  input: {
    executionId: string;
    organizationId: string;
    currentStepId: string;
    currentStepTitle: string;
    currentStage: AttackExecutionStatus;
  }
): Promise<AttackExecution> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("attack_simulation_executions")
    .update({
      status: "executing",
      current_stage: input.currentStage,
      current_step_id: input.currentStepId,
      current_step_title: input.currentStepTitle,
      started_at: now,
      updated_at: now,
    })
    .eq("id", input.executionId)
    .eq("organization_id", input.organizationId)
    .select("*")
    .single();

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  return attackExecutionSchema.parse(mapAttackExecutionRow(data));
}
