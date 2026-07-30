import { z } from "zod";
import { ATTACK_SEVERITIES } from "./enums";
import { jsonObjectSchema, uuidSchema } from "./shared";

/** Red Team output normalized for ASE planning (no execution side effects). */
export const attackHypothesisSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(256),
  description: z.string().max(8000),
  category: z.string().min(1).max(64),
  severity: z.enum(ATTACK_SEVERITIES),
  confidence: z.number().min(0).max(1),
  source: z.string().min(1).max(64),
  adapterHint: z.string().min(1).max(128).optional(),
  protectedAsset: z
    .object({
      type: z.string().min(1).max(64),
      label: z.string().min(1).max(256),
    })
    .optional(),
  attackerProfile: jsonObjectSchema.optional(),
  metadata: jsonObjectSchema.optional(),
});

export type AttackHypothesis = z.infer<typeof attackHypothesisSchema>;

export const attackHypothesisListSchema = z.array(attackHypothesisSchema).min(1).max(100);

export type AttackHypothesisList = z.infer<typeof attackHypothesisListSchema>;

export function attackHypothesisFromRedTeamFinding(input: {
  id: string;
  title: string;
  description: string;
  category?: string | null;
  severity?: string | null;
  confidence?: number | null;
  source: string;
  metadata?: Record<string, unknown>;
}): AttackHypothesis {
  const severityRaw = (input.severity ?? "medium").toLowerCase();
  const severity = ATTACK_SEVERITIES.includes(severityRaw as AttackHypothesis["severity"])
    ? (severityRaw as AttackHypothesis["severity"])
    : "medium";

  return attackHypothesisSchema.parse({
    id: input.id,
    title: input.title,
    description: input.description,
    category: (input.category ?? "general").toLowerCase(),
    severity,
    confidence: Math.max(0, Math.min(1, input.confidence ?? 0.5)),
    source: input.source,
    adapterHint:
      typeof input.metadata?.adapterHint === "string" ? input.metadata.adapterHint : undefined,
    protectedAsset:
      input.metadata?.protectedAsset &&
      typeof input.metadata.protectedAsset === "object" &&
      !Array.isArray(input.metadata.protectedAsset)
        ? input.metadata.protectedAsset
        : undefined,
    attackerProfile:
      input.metadata?.attackerProfile &&
      typeof input.metadata.attackerProfile === "object" &&
      !Array.isArray(input.metadata.attackerProfile)
        ? (input.metadata.attackerProfile as Record<string, unknown>)
        : undefined,
    metadata: input.metadata ?? {},
  });
}
