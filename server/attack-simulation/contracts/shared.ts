import { z } from "zod";

export const uuidSchema = z.string().uuid();

export const tenantContextSchema = z.object({
  organizationId: uuidSchema,
  projectId: uuidSchema,
});

export const progressFieldsSchema = z.object({
  progressPercent: z.number().int().min(0).max(100),
  estimatedRemainingMs: z.number().int().min(0).nullable(),
});

export const timestampSchema = z.string().datetime();

export type JsonObject = Record<string, unknown>;

export const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), z.unknown());
