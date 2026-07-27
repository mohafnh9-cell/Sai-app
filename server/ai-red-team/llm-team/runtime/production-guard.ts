import type { AIExecutionMode } from "./runtime.types";
import { AI_RUNTIME_PRODUCTION_FORBIDDEN } from "./runtime.config";

export function assertSafeAiExecutionMode(mode: AIExecutionMode): void {
  if (!AI_RUNTIME_PRODUCTION_FORBIDDEN) {
    throw new Error("AI_RUNTIME_PRODUCTION_FORBIDDEN must remain true.");
  }
  if (mode === "staging_candidate") {
    throw new Error("staging_candidate is planning-only — blocked for safe runtime execution.");
  }
}

export function isSyntheticExecutionMode(mode: AIExecutionMode): boolean {
  return (
    mode === "mock_llm" ||
    mode === "conversation_simulation" ||
    mode === "synthetic_tool" ||
    mode === "synthetic_mcp" ||
    mode === "synthetic_agent" ||
    mode === "synthetic_rag" ||
    mode === "static_analysis"
  );
}

export function toolInvocationWouldBeUnsafe(toolLabel: string): boolean {
  const lower = toolLabel.toLowerCase();
  return (
    lower.includes("production") ||
    ["delete", "payment", "email", "charge", "transfer", "payout"].some((p) => lower.includes(p))
  );
}
