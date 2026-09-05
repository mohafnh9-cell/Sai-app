/**
 * Phase 30 -- central, testable classification of which deterministic rules
 * are eligible for the selective AI reasoning overlay.
 *
 * This is the ONLY place rule-id -> AI-eligibility mapping is decided.
 * Nothing else in the codebase should scatter rule-name checks for this
 * purpose (Phase 30 requirement).
 *
 * Category C (Phase 29 audit): rules that detect ABSENCE of a recognized
 * pattern rather than confirming exploitability -- authorization/business-
 * logic-shaped findings the deterministic engine cannot itself confirm or
 * deny. These are the only findings eligible for AI interpretation.
 *
 * IDOR / broken object-level authorization has NO corresponding deterministic
 * rule id (Phase 29 finding) -- it is intentionally absent from every map
 * below. The AI reasoning layer must never be given license to invent one;
 * see server/ai-reasoning/prompt.ts for the explicit instruction covering
 * this.
 */

export type AiEligibilityCategory = "A" | "B" | "C" | "AI_NOT_ELIGIBLE";

/** Category C -- the only rules eligible for the AI reasoning overlay. */
export const CATEGORY_C_RULE_IDS: ReadonlySet<string> = new Set([
  "authz.insufficient",
  "injection.ssrf",
  "api.mass-assignment",
  "frontend.client-authz",
]);

/**
 * Category B -- deterministic + contextual, informational only in Phase 30.
 * Not sent to AI reasoning; kept here so the classification is complete and
 * testable rather than implicit.
 */
export const CATEGORY_B_RULE_IDS: ReadonlySet<string> = new Set([
  "auth.missing",
  "validation.missing",
  "auth.password-reset-exposed",
  "database.unsafe-raw-query",
  "web.csrf-missing",
  "mcp.security",
  "prompt-injection.security",
  "agent-action.security",
  "auth.admin-route",
  "validation.client-only-risk",
]);

/** Every other registered rule id is Category A (deterministic-sufficient). */
export function classifyRuleForAiReasoning(ruleId: string | null | undefined): AiEligibilityCategory {
  if (!ruleId) return "AI_NOT_ELIGIBLE";
  if (CATEGORY_C_RULE_IDS.has(ruleId)) return "C";
  if (CATEGORY_B_RULE_IDS.has(ruleId)) return "B";
  return "A";
}

/** The single gate used by the AI reasoning orchestrator: only Category C is ever sent to Claude. */
export function isEligibleForAiReasoning(ruleId: string | null | undefined): boolean {
  return classifyRuleForAiReasoning(ruleId) === "C";
}
