import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { TERMINAL_ATTACK_EXECUTION_STATUSES } from "../contracts/enums";
import {
  cancelAttackCampaignRecord,
  getAttackCampaignById,
} from "../persistence/campaign-repository";
import {
  cancelAttackExecutionRecord,
  listAttackExecutionsForCampaign,
} from "../persistence/execution-repository";
import { appendAttackRuntimeEvent } from "../persistence/runtime-event-repository";

export class CancelAttackSimulationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "CancelAttackSimulationError";
  }
}

export async function cancelAttackCampaign(
  admin: SupabaseClient,
  input: { campaignId: string; organizationId: string; projectId: string }
): Promise<{ cancelled: boolean; idempotent: boolean; campaignId: string }> {
  const existing = await getAttackCampaignById(admin, input.campaignId, input.organizationId);
  if (!existing || existing.projectId !== input.projectId) {
    throw new CancelAttackSimulationError("Campaign not found", "CAMPAIGN_NOT_FOUND", 404);
  }

  if (existing.status === "cancelled") {
    return { cancelled: true, idempotent: true, campaignId: existing.id };
  }

  if (["completed", "failed"].includes(existing.status)) {
    throw new CancelAttackSimulationError(
      "Campaign cannot be cancelled in its current state",
      "CAMPAIGN_NOT_CANCELLABLE",
      409
    );
  }

  const campaign = await cancelAttackCampaignRecord(admin, {
    campaignId: input.campaignId,
    organizationId: input.organizationId,
  });

  const executions = await listAttackExecutionsForCampaign(
    admin,
    campaign.id,
    input.organizationId
  );

  for (const execution of executions) {
    if (!TERMINAL_ATTACK_EXECUTION_STATUSES.has(execution.status)) {
      await cancelAttackExecutionRecord(admin, {
        executionId: execution.id,
        organizationId: input.organizationId,
      });
    }
  }

  await appendAttackRuntimeEvent(admin, {
    campaignId: campaign.id,
    executionId: null,
    stepId: null,
    organizationId: campaign.organizationId,
    projectId: campaign.projectId,
    correlationId: campaign.correlationId,
    eventType: "attack_cancelled",
    payload: { scope: "campaign" },
  });

  return { cancelled: campaign.status === "cancelled", idempotent: false, campaignId: campaign.id };
}

export async function cancelAttackExecution(
  admin: SupabaseClient,
  input: { executionId: string; organizationId: string; projectId: string }
): Promise<{ cancelled: boolean; idempotent: boolean; executionId: string; campaignId: string }> {
  const { getAttackExecutionById } = await import("../persistence/execution-repository");
  const existing = await getAttackExecutionById(admin, input.executionId, input.organizationId);
  if (!existing || existing.projectId !== input.projectId) {
    throw new CancelAttackSimulationError("Execution not found", "EXECUTION_NOT_FOUND", 404);
  }

  if (existing.status === "cancelled") {
    return {
      cancelled: true,
      idempotent: true,
      executionId: existing.id,
      campaignId: existing.campaignId,
    };
  }

  if (TERMINAL_ATTACK_EXECUTION_STATUSES.has(existing.status)) {
    throw new CancelAttackSimulationError(
      "Execution cannot be cancelled in its current state",
      "EXECUTION_NOT_CANCELLABLE",
      409
    );
  }

  const execution = await cancelAttackExecutionRecord(admin, {
    executionId: input.executionId,
    organizationId: input.organizationId,
  });

  await appendAttackRuntimeEvent(admin, {
    campaignId: execution.campaignId,
    executionId: execution.id,
    stepId: null,
    organizationId: execution.organizationId,
    projectId: execution.projectId,
    correlationId: execution.correlationId,
    eventType: "attack_cancelled",
    payload: { scope: "execution" },
  });

  return {
    cancelled: execution.status === "cancelled",
    idempotent: false,
    executionId: execution.id,
    campaignId: execution.campaignId,
  };
}
