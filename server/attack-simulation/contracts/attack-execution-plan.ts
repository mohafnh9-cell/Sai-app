import { z } from "zod";
import { jsonObjectSchema, timestampSchema, uuidSchema } from "./shared";

/** Frozen plan snapshot for an execution (immutable after creation). */
export const attackExecutionPlanSchema = z.object({
  id: uuidSchema,
  executionId: uuidSchema,
  campaignId: uuidSchema,
  organizationId: uuidSchema,
  projectId: uuidSchema,
  version: z.number().int().min(1),
  stepIds: z.array(uuidSchema),
  totalWeight: z.number().int().min(1).max(10_000),
  planHash: z.string().min(8).max(128),
  metadata: jsonObjectSchema,
  createdAt: timestampSchema,
});

export type AttackExecutionPlan = z.infer<typeof attackExecutionPlanSchema>;

export const createAttackExecutionPlanInputSchema = attackExecutionPlanSchema.pick({
  executionId: true,
  campaignId: true,
  organizationId: true,
  projectId: true,
  version: true,
  stepIds: true,
  totalWeight: true,
  planHash: true,
  metadata: true,
});

export type CreateAttackExecutionPlanInput = z.infer<typeof createAttackExecutionPlanInputSchema>;
