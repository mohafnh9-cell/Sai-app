import { z } from "zod";
import { ATTACK_SAFE_FIX_STATUSES } from "./enums";
import { jsonObjectSchema, timestampSchema, uuidSchema } from "./shared";

/** Safe fix artifact generated from attack simulation (links to safe_fix_records in later slices). */
export const attackSafeFixSchema = z.object({
  id: uuidSchema,
  mitigationId: uuidSchema,
  findingId: uuidSchema,
  executionId: uuidSchema,
  campaignId: uuidSchema,
  organizationId: uuidSchema,
  projectId: uuidSchema,
  safeFixRecordId: uuidSchema.nullable(),
  status: z.enum(ATTACK_SAFE_FIX_STATUSES),
  cursorPrompt: z.string().max(32_000),
  patchProposal: jsonObjectSchema.nullable(),
  pullRequestProposal: jsonObjectSchema.nullable(),
  requiredTests: z.array(z.string().max(2000)),
  rollbackPlan: z.string().max(4000),
  affectedFiles: z.array(z.string().max(512)),
  confidence: z.number().min(0).max(1),
  implementationRisk: z.enum(["low", "medium", "high"]),
  estimatedLoc: z.number().int().min(0).nullable(),
  metadata: jsonObjectSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type AttackSafeFix = z.infer<typeof attackSafeFixSchema>;

export const createAttackSafeFixInputSchema = attackSafeFixSchema.omit({
  id: true,
  safeFixRecordId: true,
  createdAt: true,
  updatedAt: true,
});

export type CreateAttackSafeFixInput = z.infer<typeof createAttackSafeFixInputSchema>;
