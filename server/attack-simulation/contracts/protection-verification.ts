import { z } from "zod";
import { PROTECTION_VERIFICATION_OUTCOMES } from "./enums";
import { jsonObjectSchema, timestampSchema, uuidSchema } from "./shared";

export const protectionVerificationSchema = z.object({
  id: uuidSchema,
  replayId: uuidSchema,
  campaignId: uuidSchema,
  organizationId: uuidSchema,
  projectId: uuidSchema,
  originalExecutionId: uuidSchema,
  replayExecutionId: uuidSchema,
  findingId: uuidSchema.nullable(),
  outcome: z.enum(PROTECTION_VERIFICATION_OUTCOMES),
  originalEvidenceId: uuidSchema.nullable(),
  replayEvidenceId: uuidSchema.nullable(),
  comparison: jsonObjectSchema,
  verifiedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});

export type ProtectionVerification = z.infer<typeof protectionVerificationSchema>;

export const createProtectionVerificationInputSchema = protectionVerificationSchema.omit({
  id: true,
  verifiedAt: true,
  createdAt: true,
});

export type CreateProtectionVerificationInput = z.infer<
  typeof createProtectionVerificationInputSchema
>;
