import "server-only";

/**
 * Phase 37, workstream D/section 10: server-side-only AI configuration.
 * The MCP client can never choose provider/model/API key/temperature/token
 * budget/system prompt -- none of those are ever read from a request.
 */
export type AiProvider = "anthropic" | "test-double";

export function isAiReasoningEnabled(): boolean {
  return process.env.AI_REASONING_ENABLED?.trim() === "true";
}

export function getAiProvider(): AiProvider {
  const raw = process.env.AI_PROVIDER?.trim();
  return raw === "anthropic" ? "anthropic" : "test-double";
}

export function getAiReasoningModel(): string {
  return process.env.AI_REASONING_MODEL?.trim() || "claude-sonnet-5";
}

export function getAiReasoningTimeoutMs(): number {
  const raw = Number(process.env.AI_REASONING_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 30_000;
}

export function getAiReasoningMaxTokens(): number {
  const raw = Number(process.env.AI_REASONING_MAX_TOKENS);
  return Number.isFinite(raw) && raw > 0 ? raw : 2_000;
}
