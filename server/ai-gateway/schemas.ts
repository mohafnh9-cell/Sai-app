import "server-only";

import { z } from "zod";

/**
 * Phase 37, section 12: strict structured output only -- never free-form
 * prose parsed as a security decision. Every claim about a finding must
 * reference an id that the caller actually supplied; the gateway (not the
 * model) is responsible for rejecting an id the model invented (see
 * gateway.ts's evidence-reference validation, which runs AFTER this schema
 * check).
 */
export const CONFIDENCE_LABELS = ["CONFIRMED", "SUPPORTED", "LIKELY", "POSSIBLE", "UNVERIFIED"] as const;
export type ConfidenceLabel = (typeof CONFIDENCE_LABELS)[number];

const PrioritizedFindingSchema = z.object({
  findingId: z.string().min(1),
  evidenceIds: z.array(z.string()).default([]),
  reason: z.string().min(1),
  confidence: z.enum(CONFIDENCE_LABELS),
});

const AttackChainAssessmentSchema = z.object({
  findingIds: z.array(z.string()).min(1),
  narrative: z.string().min(1),
  confidence: z.enum(CONFIDENCE_LABELS),
});

const InvestigationRecommendationSchema = z.object({
  type: z.literal("INVESTIGATE"),
  reason: z.string().min(1),
  findingIds: z.array(z.string()).default([]),
  requiredCapability: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const SecurityReasoningResultSchema = z.object({
  summary: z.string().min(1).max(2_000),
  prioritizedFindings: z.array(PrioritizedFindingSchema).max(20),
  attackChainAssessments: z.array(AttackChainAssessmentSchema).max(10),
  architectureObservations: z.array(z.string()).max(10),
  investigationRecommendations: z.array(InvestigationRecommendationSchema).max(5),
  remediationRecommendations: z.array(z.string()).max(10),
  confidence: z.enum(CONFIDENCE_LABELS),
  evidenceReferences: z.array(z.string()).max(50),
});

export type SecurityReasoningResult = z.infer<typeof SecurityReasoningResultSchema>;
