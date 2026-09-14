import "server-only";

import type { SecurityReasoningResult } from "./schemas";

/**
 * Phase 37, section 9: provider-agnostic AI Gateway contract. Adding
 * OpenAI or Gemini means implementing this interface under providers/,
 * never touching the orchestrator or the security-reasoner.
 */
export type StructuredReasoningRequest = {
  /** Already redacted/minimized, evidence-first structured context -- never a raw repository dump (section 11/28). */
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  timeoutMs: number;
};

export type AiProviderClient = {
  id: string;
  generateStructured(request: StructuredReasoningRequest): Promise<{ rawText: string; usage?: { inputTokens?: number; outputTokens?: number } }>;
};

/** Phase 37, section 19: explicit states -- AI failure is never security cleanliness. */
export type AiReasoningStatus = "DISABLED" | "NOT_REQUESTED" | "RUNNING" | "COMPLETED" | "FAILED" | "TIMED_OUT" | "UNAVAILABLE";

export type AiReasoningOutcome =
  | { status: "COMPLETED"; result: SecurityReasoningResult; provider: string; model: string; durationMs: number }
  | { status: "DISABLED" | "NOT_REQUESTED" | "UNAVAILABLE"; reason: string }
  | { status: "FAILED" | "TIMED_OUT"; reason: string; durationMs: number };
