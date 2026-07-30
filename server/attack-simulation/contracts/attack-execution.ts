import { z } from "zod";
import { ATTACK_EXECUTION_STATUSES, ATTACK_RUNTIME_MODES } from "./enums";
import { jsonObjectSchema, progressFieldsSchema, timestampSchema, uuidSchema } from "./shared";

export const attackExecutionSchema = z.object({
  id: uuidSchema,
  campaignId: uuidSchema,
  scenarioId: uuidSchema,
  scanId: uuidSchema,
  scanJobId: uuidSchema.nullable(),
  projectId: uuidSchema,
  organizationId: uuidSchema,
  commitSha: z.string().min(7).max(64),
  runtimeMode: z.enum(ATTACK_RUNTIME_MODES),
  correlationId: uuidSchema,
  attackerProfile: jsonObjectSchema,
  protectedAssets: z.array(jsonObjectSchema),
  status: z.enum(ATTACK_EXECUTION_STATUSES),
  currentStage: z.enum(ATTACK_EXECUTION_STATUSES),
  currentStepId: uuidSchema.nullable(),
  currentStepTitle: z.string().max(256).nullable(),
  elapsedMs: z.number().int().min(0),
  ...progressFieldsSchema.shape,
  startedAt: timestampSchema.nullable(),
  updatedAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
  cancelledAt: timestampSchema.nullable(),
  failureCode: z.string().max(128).nullable(),
  safeFailureMessage: z.string().max(512).nullable(),
  createdAt: timestampSchema,
});

export type AttackExecution = z.infer<typeof attackExecutionSchema>;

export const createAttackExecutionInputSchema = attackExecutionSchema.pick({
  campaignId: true,
  scenarioId: true,
  scanId: true,
  scanJobId: true,
  projectId: true,
  organizationId: true,
  commitSha: true,
  runtimeMode: true,
  attackerProfile: true,
  protectedAssets: true,
}).extend({
  correlationId: uuidSchema.optional(),
});

export type CreateAttackExecutionInput = z.infer<typeof createAttackExecutionInputSchema>;
