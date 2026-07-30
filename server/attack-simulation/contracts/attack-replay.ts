import { z } from "zod";
import { timestampSchema, uuidSchema } from "./shared";

export const attackReplaySchema = z.object({
  id: uuidSchema,
  campaignId: uuidSchema,
  organizationId: uuidSchema,
  projectId: uuidSchema,
  originalExecutionId: uuidSchema,
  replayExecutionId: uuidSchema,
  findingId: uuidSchema.nullable(),
  safeFixId: uuidSchema.nullable(),
  startedAt: timestampSchema.nullable(),
  completedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});

export type AttackReplay = z.infer<typeof attackReplaySchema>;

export const createAttackReplayInputSchema = attackReplaySchema.pick({
  campaignId: true,
  organizationId: true,
  projectId: true,
  originalExecutionId: true,
  replayExecutionId: true,
  findingId: true,
  safeFixId: true,
});

export type CreateAttackReplayInput = z.infer<typeof createAttackReplayInputSchema>;
