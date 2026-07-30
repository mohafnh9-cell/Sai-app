import { z } from "zod";
import { ATTACK_FINDING_OUTCOMES, ATTACK_SEVERITIES } from "./enums";
import { jsonObjectSchema, timestampSchema, uuidSchema } from "./shared";

export const attackFindingSchema = z.object({
  id: uuidSchema,
  executionId: uuidSchema,
  campaignId: uuidSchema,
  scenarioId: uuidSchema,
  organizationId: uuidSchema,
  projectId: uuidSchema,
  evidenceId: uuidSchema.nullable(),
  title: z.string().min(1).max(256),
  description: z.string().max(8000),
  category: z.string().min(1).max(64),
  severity: z.enum(ATTACK_SEVERITIES),
  confidence: z.number().min(0).max(1),
  outcome: z.enum(ATTACK_FINDING_OUTCOMES),
  impact: z.string().max(4000),
  rootCause: z.string().max(4000).nullable(),
  metadata: jsonObjectSchema,
  confirmedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type AttackFinding = z.infer<typeof attackFindingSchema>;

export const createAttackFindingInputSchema = attackFindingSchema.omit({
  id: true,
  confirmedAt: true,
  createdAt: true,
  updatedAt: true,
});

export type CreateAttackFindingInput = z.infer<typeof createAttackFindingInputSchema>;
