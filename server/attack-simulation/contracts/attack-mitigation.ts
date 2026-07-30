import { z } from "zod";
import { jsonObjectSchema, timestampSchema, uuidSchema } from "./shared";

export const attackMitigationSchema = z.object({
  id: uuidSchema,
  findingId: uuidSchema,
  executionId: uuidSchema,
  campaignId: uuidSchema,
  organizationId: uuidSchema,
  projectId: uuidSchema,
  plainLanguageExplanation: z.string().max(8000),
  rootCause: z.string().max(4000),
  recommendedProtection: z.string().max(8000),
  likelyAffectedFiles: z.array(z.string().max(512)),
  implementationSteps: z.array(z.string().max(2000)),
  implementationRisk: z.enum(["low", "medium", "high"]),
  safeFixConfidence: z.number().min(0).max(1),
  estimatedLoc: z.number().int().min(0).nullable(),
  rollbackGuidance: z.string().max(4000),
  residualRisk: z.string().max(4000),
  metadata: jsonObjectSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type AttackMitigation = z.infer<typeof attackMitigationSchema>;

export const createAttackMitigationInputSchema = attackMitigationSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CreateAttackMitigationInput = z.infer<typeof createAttackMitigationInputSchema>;
