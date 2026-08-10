import type { McpTranslator } from "./i18n";

export type McpMode =
  | "production_review"
  | "production_review_request"
  | "safe_fix"
  | "continuous_review"
  | "production_history"
  | "application_discovery"
  | "full_product_audit"
  | "authorize_dynamic_target";

/**
 * Every SequrAI MCP response begins with the same two lines:
 *
 *   SEQURAI
 *
 *   <MODE LABEL>
 *
 * followed by deterministic, calm, non-theatrical copy. No "activating",
 * "thinking", or "scanning your universe" language is ever produced here.
 */
export function activityHeader(mode: McpMode, t: McpTranslator): string {
  return `${t("header")}\n\n${t(`modes.${mode}`)}`;
}

export function buildTextResponse(mode: McpMode, t: McpTranslator, lines: string[]): string {
  return [activityHeader(mode, t), "", ...lines].join("\n");
}
