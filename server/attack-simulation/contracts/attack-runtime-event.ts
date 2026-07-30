import { z } from "zod";
import { ATTACK_RUNTIME_EVENT_TYPES } from "./enums";
import { jsonObjectSchema, timestampSchema, uuidSchema } from "./shared";

/** Persistent runtime event for Realtime streaming (Inngest → DB → Supabase Realtime → UI). */
export const attackRuntimeEventSchema = z.object({
  id: uuidSchema,
  campaignId: uuidSchema,
  executionId: uuidSchema.nullable(),
  stepId: uuidSchema.nullable(),
  organizationId: uuidSchema,
  projectId: uuidSchema,
  correlationId: uuidSchema,
  eventType: z.enum(ATTACK_RUNTIME_EVENT_TYPES),
  payload: jsonObjectSchema,
  occurredAt: timestampSchema,
  createdAt: timestampSchema,
});

export type AttackRuntimeEvent = z.infer<typeof attackRuntimeEventSchema>;

export const createAttackRuntimeEventInputSchema = attackRuntimeEventSchema.omit({
  id: true,
  createdAt: true,
}).extend({
  occurredAt: timestampSchema.optional(),
});

export type CreateAttackRuntimeEventInput = z.infer<typeof createAttackRuntimeEventInputSchema>;

export const attackRuntimeEventPayloadSchema = z.object({
  stage: z.string().max(64).optional(),
  progressPercent: z.number().int().min(0).max(100).optional(),
  estimatedRemainingMs: z.number().int().min(0).nullable().optional(),
  stepKind: z.string().max(64).optional(),
  stepLabel: z.string().max(256).optional(),
  safeMessage: z.string().max(512).optional(),
  metadata: jsonObjectSchema.optional(),
});

export type AttackRuntimeEventPayload = z.infer<typeof attackRuntimeEventPayloadSchema>;
