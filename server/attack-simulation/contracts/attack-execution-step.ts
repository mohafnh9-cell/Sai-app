import { z } from "zod";
import { ATTACK_EXECUTION_STEP_STATUSES } from "./enums";
import { jsonObjectSchema, timestampSchema, uuidSchema } from "./shared";

export const attackExecutionStepSchema = z.object({
  id: uuidSchema,
  executionId: uuidSchema,
  campaignId: uuidSchema,
  organizationId: uuidSchema,
  projectId: uuidSchema,
  sortOrder: z.number().int().min(0),
  kind: z.string().min(1).max(64),
  label: z.string().min(1).max(256),
  weight: z.number().int().min(1).max(100),
  status: z.enum(ATTACK_EXECUTION_STEP_STATUSES),
  startedAt: timestampSchema.nullable(),
  completedAt: timestampSchema.nullable(),
  durationMs: z.number().int().min(0).nullable(),
  failureCode: z.string().max(128).nullable(),
  metadata: jsonObjectSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type AttackExecutionStep = z.infer<typeof attackExecutionStepSchema>;

export const DEFAULT_ATTACK_STEP_TEMPLATE: ReadonlyArray<
  Pick<AttackExecutionStep, "kind" | "label" | "weight" | "sortOrder">
> = [
  { sortOrder: 0, kind: "validate_preconditions", label: "Validate preconditions", weight: 10 },
  { sortOrder: 1, kind: "create_fixtures", label: "Create fixtures", weight: 15 },
  { sortOrder: 2, kind: "authenticate_attacker", label: "Authenticate attacker", weight: 10 },
  { sortOrder: 3, kind: "execute_request", label: "Execute request", weight: 25 },
  { sortOrder: 4, kind: "observe_response", label: "Observe response", weight: 15 },
  { sortOrder: 5, kind: "verify_side_effects", label: "Verify side effects", weight: 15 },
  { sortOrder: 6, kind: "collect_evidence", label: "Collect evidence", weight: 5 },
  { sortOrder: 7, kind: "cleanup", label: "Cleanup", weight: 5 },
];

export const createAttackExecutionStepInputSchema = attackExecutionStepSchema.pick({
  executionId: true,
  campaignId: true,
  organizationId: true,
  projectId: true,
  sortOrder: true,
  kind: true,
  label: true,
  weight: true,
  metadata: true,
});

export type CreateAttackExecutionStepInput = z.infer<typeof createAttackExecutionStepInputSchema>;
