import { z } from "zod";

/**
 * Phase 30 -- strict schema for the selective AI reasoning overlay.
 *
 * GOLDEN RULE: this schema has no field for severity, score, riskScore,
 * blockersCount, verdict, status, or isSafe/safe. Zod strips unknown keys by
 * default, so even if Claude's output contains one of those fields it is
 * silently dropped during parsing -- there is no code path anywhere that
 * reads such a field from AI output. Authority over those values belongs
 * exclusively to brain/production-verdict/engine.ts.
 */

export const AI_REASONING_VERSION = "v1";

export const ExploitabilityAssessment = z.enum([
  "confirmed",
  "likely_exploitable",
  "uncertain",
  "likely_false_positive",
]);
export type ExploitabilityAssessment = z.infer<typeof ExploitabilityAssessment>;

export const AiConfidence = z.enum(["high", "medium", "low"]);
export type AiConfidence = z.infer<typeof AiConfidence>;

/** Bounded chain severity -- describes the AI's own assessment of a chain, never a finding's deterministic severity. */
export const ChainSeverity = z.enum(["critical", "high", "medium", "low"]);
export type ChainSeverity = z.infer<typeof ChainSeverity>;

const FindingReasoningSchema = z.object({
  findingId: z.string().uuid(),
  exploitability: ExploitabilityAssessment,
  confidence: AiConfidence,
  reasoning: z.string().min(1).max(1000),
  supportingFindingIds: z.array(z.string().uuid()).max(10).default([]),
});
export type FindingReasoning = z.infer<typeof FindingReasoningSchema>;

const AttackChainSchema = z.object({
  findingIds: z.array(z.string().uuid()).min(2).max(8),
  severity: ChainSeverity,
  confidence: AiConfidence,
  explanation: z.string().min(1).max(1000),
});
export type AttackChain = z.infer<typeof AttackChainSchema>;

/**
 * The raw model response shape. `.partial()` so a response missing one of
 * the two top-level arrays still validates -- callers default to `[]`.
 * NOTE: this schema intentionally has no `.passthrough()` -- any additional
 * top-level key the model emits (verdict, riskScore, isSafe, severity, ...)
 * is dropped, never reaches application code.
 */
export const AiReasoningResponseSchema = z
  .object({
    findings: z.array(FindingReasoningSchema).max(20),
    attackChains: z.array(AttackChainSchema).max(10),
  })
  .partial();
export type AiReasoningResponse = z.infer<typeof AiReasoningResponseSchema>;

export type AiReasoningFailureReason =
  | "no_api_key"
  | "no_eligible_findings"
  | "budget_exceeded"
  | "timeout"
  | "network_error"
  | "api_error"
  | "empty_response"
  | "malformed_json"
  | "schema_invalid"
  | "prompt_injection_detected"
  | "unknown_error";

/** Persisted overlay shape -- additive only, never authoritative. */
export type AiReasoningOverlay = {
  version: typeof AI_REASONING_VERSION;
  status: "completed" | "failed" | "skipped";
  model: string | null;
  scanId: string;
  organizationId: string;
  projectId: string;
  analyzedFindingIds: string[];
  evidenceHash: string;
  findings: FindingReasoning[];
  attackChains: AttackChain[];
  failureReason: AiReasoningFailureReason | null;
  tokensUsed: number;
  durationMs: number;
  cacheHit: boolean;
  generatedAt: string;
};
