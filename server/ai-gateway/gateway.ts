import "server-only";

import { getAiProvider, getAiReasoningMaxTokens, getAiReasoningModel, getAiReasoningTimeoutMs, isAiReasoningEnabled } from "./config";
import { createAnthropicProvider } from "./providers/anthropic";
import { createTestDoubleProvider } from "./providers/test-double";
import { SecurityReasoningResultSchema, type SecurityReasoningResult } from "./schemas";
import type { AiProviderClient, AiReasoningOutcome } from "./types";

/**
 * Phase 37, workstream D: the single entrypoint every caller uses --
 * `server/security-orchestrator/security-reasoner.ts` never talks to a
 * provider directly. Section 18/19: real timeout, no infinite retries
 * (SDK-level maxRetries: 1 in the provider, no gateway-level retry loop at
 * all), and AI failure always resolves to an explicit state, never thrown
 * up to break the caller.
 */
function resolveProvider(): AiProviderClient {
  const provider = getAiProvider();
  if (provider === "anthropic") return createAnthropicProvider(getAiReasoningModel());
  return createTestDoubleProvider();
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("AI_REASONING_TIMEOUT")), timeoutMs);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/**
 * Section 12/29: extracts every id the model claims to be referencing
 * (findingId, evidenceIds, evidenceReferences, attack-chain findingIds) and
 * rejects the whole result if ANY of them isn't in the set of ids the
 * caller actually supplied -- the model can never invent a finding or
 * evidence id that then gets treated as real.
 */
function validateEvidenceReferences(result: SecurityReasoningResult, knownIds: ReadonlySet<string>): string[] {
  const violations: string[] = [];
  const check = (id: string, where: string) => {
    if (!knownIds.has(id)) violations.push(`${where} references unknown id "${id}"`);
  };
  for (const f of result.prioritizedFindings) {
    check(f.findingId, "prioritizedFindings.findingId");
    for (const e of f.evidenceIds) check(e, "prioritizedFindings.evidenceIds");
  }
  for (const chain of result.attackChainAssessments) {
    for (const id of chain.findingIds) check(id, "attackChainAssessments.findingIds");
  }
  for (const rec of result.investigationRecommendations) {
    for (const id of rec.findingIds) check(id, "investigationRecommendations.findingIds");
  }
  for (const id of result.evidenceReferences) check(id, "evidenceReferences");
  return violations;
}

export async function generateStructuredSecurityReasoning(input: {
  systemPrompt: string;
  userPrompt: string;
  knownIds: ReadonlySet<string>;
  providerOverride?: AiProviderClient;
}): Promise<AiReasoningOutcome> {
  if (!isAiReasoningEnabled()) {
    return { status: "DISABLED", reason: "AI_REASONING_ENABLED is not set to true" };
  }

  const started = Date.now();
  const provider = input.providerOverride ?? resolveProvider();
  const timeoutMs = getAiReasoningTimeoutMs();
  const maxTokens = getAiReasoningMaxTokens();

  let rawText: string;
  try {
    const response = await withTimeout(
      provider.generateStructured({ systemPrompt: input.systemPrompt, userPrompt: input.userPrompt, maxTokens, timeoutMs }),
      timeoutMs
    );
    rawText = response.rawText;
  } catch (error) {
    const durationMs = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    if (message === "AI_REASONING_TIMEOUT") {
      return { status: "TIMED_OUT", reason: "AI provider did not respond within the configured timeout", durationMs };
    }
    return { status: "FAILED", reason: `AI provider error: ${message}`, durationMs };
  }

  let parsedJson: unknown;
  try {
    // Providers occasionally wrap JSON in prose or code fences -- extract
    // the first balanced-looking JSON object rather than assuming column 0.
    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");
    parsedJson = JSON.parse(start >= 0 && end > start ? rawText.slice(start, end + 1) : rawText);
  } catch {
    return { status: "FAILED", reason: "AI output was not valid JSON", durationMs: Date.now() - started };
  }

  const parsed = SecurityReasoningResultSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { status: "FAILED", reason: `AI output failed schema validation: ${parsed.error.issues[0]?.message ?? "unknown"}`, durationMs: Date.now() - started };
  }

  const violations = validateEvidenceReferences(parsed.data, input.knownIds);
  if (violations.length > 0) {
    return { status: "FAILED", reason: `AI output referenced unverifiable ids: ${violations[0]}`, durationMs: Date.now() - started };
  }

  return {
    status: "COMPLETED",
    result: parsed.data,
    provider: provider.id,
    model: getAiReasoningModel(),
    durationMs: Date.now() - started,
  };
}
