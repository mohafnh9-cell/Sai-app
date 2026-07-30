import { z } from "zod";
import { ATTACK_CAMPAIGN_STATUSES, ATTACK_RUNTIME_MODES } from "./enums";
import { progressFieldsSchema, timestampSchema, uuidSchema } from "./shared";

/** Root aggregate for a full Production Review attack simulation run. */
export const attackCampaignSchema = z.object({
  id: uuidSchema,
  scanId: uuidSchema,
  scanJobId: uuidSchema.nullable(),
  projectId: uuidSchema,
  organizationId: uuidSchema,
  commitSha: z.string().min(7).max(64),
  runtimeMode: z.enum(ATTACK_RUNTIME_MODES),
  status: z.enum(ATTACK_CAMPAIGN_STATUSES),
  correlationId: uuidSchema,
  authorizationId: uuidSchema.nullable(),
  startedAt: timestampSchema.nullable(),
  completedAt: timestampSchema.nullable(),
  cancelledAt: timestampSchema.nullable(),
  failureCode: z.string().max(128).nullable(),
  safeFailureMessage: z.string().max(512).nullable(),
  totalScenarios: z.number().int().min(0),
  totalExecutions: z.number().int().min(0),
  completedExecutions: z.number().int().min(0),
  confirmedFindings: z.number().int().min(0),
  blockedExecutions: z.number().int().min(0),
  ...progressFieldsSchema.shape,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type AttackCampaign = z.infer<typeof attackCampaignSchema>;

export const createAttackCampaignInputSchema = z.object({
  scanId: uuidSchema,
  scanJobId: uuidSchema.nullable(),
  projectId: uuidSchema,
  organizationId: uuidSchema,
  commitSha: z.string().min(7).max(64),
  runtimeMode: z.enum(ATTACK_RUNTIME_MODES),
  authorizationId: uuidSchema.nullable().optional(),
  correlationId: uuidSchema.optional(),
});

export type CreateAttackCampaignInput = z.infer<typeof createAttackCampaignInputSchema>;
