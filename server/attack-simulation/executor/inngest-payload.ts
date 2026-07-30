import { z } from "zod";
import { uuidSchema } from "../contracts/shared";

export const attackExecutionRunPayloadSchema = z.object({
  organizationId: uuidSchema,
  projectId: uuidSchema,
  campaignId: uuidSchema,
  executionId: uuidSchema,
  correlationId: uuidSchema.optional(),
  targetUrl: z.string().url().nullable().optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export type AttackExecutionRunPayload = z.infer<typeof attackExecutionRunPayloadSchema>;

export function parseAttackExecutionRunInngestEvent(data: unknown): AttackExecutionRunPayload {
  const parsed = attackExecutionRunPayloadSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }
  return parsed.data;
}

export function buildAttackExecutionRunPayload(input: AttackExecutionRunPayload): AttackExecutionRunPayload {
  return attackExecutionRunPayloadSchema.parse(input);
}

export function attackExecutionIdempotencyKey(input: {
  organizationId: string;
  executionId: string;
  stepId?: string;
}): string {
  return input.stepId
    ? `${input.organizationId}:${input.executionId}:${input.stepId}`
    : `${input.organizationId}:${input.executionId}`;
}
