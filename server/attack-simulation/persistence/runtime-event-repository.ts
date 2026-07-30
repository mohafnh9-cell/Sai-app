import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttackRuntimeEventType } from "../contracts/enums";
import {
  attackRuntimeEventSchema,
  attackRuntimeEventPayloadSchema,
  createAttackRuntimeEventInputSchema,
  type AttackRuntimeEvent,
  type CreateAttackRuntimeEventInput,
} from "../contracts/attack-runtime-event";
import { mapAttackRuntimeEventRow } from "./mappers";
import { AttackSimulationRepositoryError } from "./campaign-repository";

export async function appendAttackRuntimeEvent(
  admin: SupabaseClient,
  input: CreateAttackRuntimeEventInput
): Promise<AttackRuntimeEvent> {
  const parsed = createAttackRuntimeEventInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AttackSimulationRepositoryError(parsed.error.message, "validation");
  }

  if (parsed.data.payload) {
    const payloadCheck = attackRuntimeEventPayloadSchema.safeParse(parsed.data.payload);
    if (!payloadCheck.success) {
      throw new AttackSimulationRepositoryError(payloadCheck.error.message, "validation");
    }
  }

  const occurredAt = parsed.data.occurredAt ?? new Date().toISOString();
  const { data, error } = await admin
    .from("attack_simulation_runtime_events")
    .insert({
      campaign_id: parsed.data.campaignId,
      execution_id: parsed.data.executionId ?? null,
      step_id: parsed.data.stepId ?? null,
      organization_id: parsed.data.organizationId,
      project_id: parsed.data.projectId,
      correlation_id: parsed.data.correlationId,
      event_type: parsed.data.eventType,
      payload: parsed.data.payload ?? {},
      occurred_at: occurredAt,
    })
    .select("*")
    .single();

  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  return attackRuntimeEventSchema.parse(mapAttackRuntimeEventRow(data));
}

export async function listAttackRuntimeEventsForCampaign(
  admin: SupabaseClient,
  input: {
    campaignId: string;
    organizationId: string;
    limit?: number;
    afterOccurredAt?: string;
  }
): Promise<AttackRuntimeEvent[]> {
  let query = admin
    .from("attack_simulation_runtime_events")
    .select("*")
    .eq("campaign_id", input.campaignId)
    .eq("organization_id", input.organizationId)
    .order("occurred_at", { ascending: true });

  if (input.afterOccurredAt) {
    query = query.gt("occurred_at", input.afterOccurredAt);
  }
  if (input.limit) {
    query = query.limit(input.limit);
  }

  const { data, error } = await query;
  if (error) throw new AttackSimulationRepositoryError(error.message, "database");
  return (data ?? []).map((row) => attackRuntimeEventSchema.parse(mapAttackRuntimeEventRow(row)));
}

export function serializeAttackRuntimeEventForRealtime(event: AttackRuntimeEvent): {
  id: string;
  campaignId: string;
  executionId: string | null;
  stepId: string | null;
  correlationId: string;
  eventType: AttackRuntimeEventType;
  payload: Record<string, unknown>;
  occurredAt: string;
} {
  return {
    id: event.id,
    campaignId: event.campaignId,
    executionId: event.executionId,
    stepId: event.stepId,
    correlationId: event.correlationId,
    eventType: event.eventType,
    payload: event.payload,
    occurredAt: event.occurredAt,
  };
}
