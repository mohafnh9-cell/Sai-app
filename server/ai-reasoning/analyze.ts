import "server-only";

import {
  CLAUDE_MAX_RETRIES,
  CLAUDE_TIMEOUT_MS,
  MODEL,
  getClient,
} from "@/server/ai-security-engine/claude-analyzer";
import { scanInjectionPatterns } from "@/server/mcp/security";
import type { BoundedFindingEvidence } from "./build-context";
import { aiReasoningSystemPrompt, aiReasoningUserPrompt } from "./prompt";
import {
  AiReasoningResponseSchema,
  type AiReasoningFailureReason,
  type AttackChain,
  type FindingReasoning,
} from "./schema";

export type AnalyzeResult =
  | {
      ok: true;
      findings: FindingReasoning[];
      attackChains: AttackChain[];
      model: string;
      tokensUsed: number;
    }
  | { ok: false; reason: AiReasoningFailureReason; detail?: string };

/**
 * A finding-reasoning or attack-chain entry that contains injected-looking
 * text in its own output is discarded rather than trusted -- defense in
 * depth in case the model echoes adversarial repository content back
 * verbatim. This never throws; it filters.
 */
function containsInjectionSignal(text: string): boolean {
  return scanInjectionPatterns(text, { source: "finding_field", path: "ai-reasoning-output" }).some(
    (d) => d.action === "BLOCK"
  );
}

function filterValidFindings(
  raw: FindingReasoning[] | undefined,
  validIds: ReadonlySet<string>
): FindingReasoning[] {
  if (!raw) return [];
  return raw
    .filter((f) => validIds.has(f.findingId))
    .filter((f) => !containsInjectionSignal(f.reasoning))
    .map((f) => ({
      ...f,
      // Strip references to unknown ids rather than discarding the whole entry.
      supportingFindingIds: f.supportingFindingIds.filter((id) => validIds.has(id) && id !== f.findingId),
    }));
}

function filterValidChains(
  raw: AttackChain[] | undefined,
  validIds: ReadonlySet<string>
): AttackChain[] {
  if (!raw) return [];
  return raw
    .map((chain) => ({ ...chain, findingIds: [...new Set(chain.findingIds)].filter((id) => validIds.has(id)) }))
    // A chain must still reference at least 2 valid, distinct findings after filtering --
    // never manufacture a chain from a single finding (Phase 30 requirement).
    .filter((chain) => chain.findingIds.length >= 2)
    .filter((chain) => !containsInjectionSignal(chain.explanation));
}

/**
 * Calls Claude with a bounded, guarded evidence bundle and returns a fully
 * validated result, or a typed failure reason. Never throws -- every
 * failure mode (no key, timeout, network error, malformed JSON, schema
 * violation, unknown finding id) is caught and returned as `{ ok: false }`
 * so the caller can treat AI reasoning as purely optional.
 */
export async function analyzeCategoryCFindings(
  evidence: BoundedFindingEvidence[]
): Promise<AnalyzeResult> {
  if (evidence.length === 0) {
    return { ok: false, reason: "no_eligible_findings" };
  }

  const anthropic = getClient();
  if (!anthropic) {
    return { ok: false, reason: "no_api_key" };
  }

  const validIds = new Set(evidence.map((e) => e.findingId));

  let raw: string;
  let tokensUsed = 0;
  try {
    const response = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: 1200,
        system: aiReasoningSystemPrompt(),
        messages: [{ role: "user", content: aiReasoningUserPrompt(evidence) }],
      },
      { timeout: CLAUDE_TIMEOUT_MS, maxRetries: CLAUDE_MAX_RETRIES }
    );
    const textBlock = response.content.find((block) => block.type === "text");
    raw = textBlock?.type === "text" ? textBlock.text : "";
    tokensUsed = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const name = error instanceof Error ? error.name : "";
    if (name === "APIConnectionTimeoutError" || /timeout/i.test(message)) {
      return { ok: false, reason: "timeout", detail: message };
    }
    if (name === "APIConnectionError" || /network|fetch failed|ECONNRESET/i.test(message)) {
      return { ok: false, reason: "network_error", detail: message };
    }
    return { ok: false, reason: "api_error", detail: message };
  }

  if (!raw?.trim()) {
    return { ok: false, reason: "empty_response" };
  }

  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    return { ok: false, reason: "malformed_json" };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
  } catch {
    return { ok: false, reason: "malformed_json" };
  }

  const validated = AiReasoningResponseSchema.safeParse(parsedJson);
  if (!validated.success) {
    return { ok: false, reason: "schema_invalid", detail: validated.error.issues.slice(0, 3).map((i) => i.message).join("; ") };
  }

  const findings = filterValidFindings(validated.data.findings, validIds);
  const attackChains = filterValidChains(validated.data.attackChains, validIds);

  return { ok: true, findings, attackChains, model: MODEL, tokensUsed };
}
