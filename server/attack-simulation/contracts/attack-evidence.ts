import { z } from "zod";
import { ATTACK_RUNTIME_MODES } from "./enums";
import { jsonObjectSchema, timestampSchema, uuidSchema } from "./shared";

export const attackEvidenceSchema = z.object({
  id: uuidSchema,
  executionId: uuidSchema,
  campaignId: uuidSchema,
  scenarioId: uuidSchema,
  organizationId: uuidSchema,
  projectId: uuidSchema,
  commitSha: z.string().min(7).max(64),
  environment: z.enum(ATTACK_RUNTIME_MODES),
  expectedBehavior: z.string().max(8000),
  observedBehavior: z.string().max(8000),
  redactedRequest: jsonObjectSchema,
  redactedResponse: jsonObjectSchema,
  statusCode: z.number().int().min(0).max(999).nullable(),
  sideEffects: jsonObjectSchema,
  preconditions: jsonObjectSchema,
  attackProfile: jsonObjectSchema,
  protectedAssets: z.array(jsonObjectSchema),
  reproducibility: z.string().max(2000),
  confidence: z.number().min(0).max(1),
  replayInstructions: z.string().max(8000),
  capturedAt: timestampSchema,
  createdAt: timestampSchema,
});

export type AttackEvidence = z.infer<typeof attackEvidenceSchema>;

export const createAttackEvidenceInputSchema = attackEvidenceSchema.omit({
  id: true,
  createdAt: true,
});

export type CreateAttackEvidenceInput = z.infer<typeof createAttackEvidenceInputSchema>;
