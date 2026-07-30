import { z } from "zod";
import { ATTACK_SCENARIO_STATUSES } from "./enums";
import { jsonObjectSchema, timestampSchema, uuidSchema } from "./shared";

export const attackScenarioSchema = z.object({
  id: uuidSchema,
  campaignId: uuidSchema,
  organizationId: uuidSchema,
  projectId: uuidSchema,
  hypothesisId: z.string().min(1).max(128),
  adapterId: z.string().min(1).max(128),
  category: z.string().min(1).max(64),
  title: z.string().min(1).max(256),
  description: z.string().max(4000),
  status: z.enum(ATTACK_SCENARIO_STATUSES),
  sortOrder: z.number().int().min(0),
  redTeamSource: z.string().max(64).nullable(),
  metadata: jsonObjectSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type AttackScenario = z.infer<typeof attackScenarioSchema>;

export const createAttackScenarioInputSchema = attackScenarioSchema.pick({
  campaignId: true,
  organizationId: true,
  projectId: true,
  hypothesisId: true,
  adapterId: true,
  category: true,
  title: true,
  description: true,
  sortOrder: true,
  redTeamSource: true,
  metadata: true,
});

export type CreateAttackScenarioInput = z.infer<typeof createAttackScenarioInputSchema>;
