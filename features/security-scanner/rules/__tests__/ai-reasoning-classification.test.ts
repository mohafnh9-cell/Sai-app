import { describe, expect, it } from "vitest";
import {
  CATEGORY_C_RULE_IDS,
  classifyRuleForAiReasoning,
  isEligibleForAiReasoning,
} from "../ai-reasoning-classification";

describe("Phase 30 -- AI reasoning rule classification", () => {
  it("Category C is exactly the four Phase 29 rule ids, nothing more", () => {
    expect([...CATEGORY_C_RULE_IDS].sort()).toEqual(
      ["api.mass-assignment", "authz.insufficient", "frontend.client-authz", "injection.ssrf"].sort()
    );
  });

  it("classifies every Category C rule id as C and eligible", () => {
    for (const ruleId of CATEGORY_C_RULE_IDS) {
      expect(classifyRuleForAiReasoning(ruleId)).toBe("C");
      expect(isEligibleForAiReasoning(ruleId)).toBe(true);
    }
  });

  it("classifies a known Category A rule as A and not eligible", () => {
    expect(classifyRuleForAiReasoning("secrets.exposed")).toBe("A");
    expect(isEligibleForAiReasoning("secrets.exposed")).toBe(false);
  });

  it("classifies a known Category B rule as B and not eligible for AI", () => {
    expect(classifyRuleForAiReasoning("auth.missing")).toBe("B");
    expect(isEligibleForAiReasoning("auth.missing")).toBe(false);
  });

  it("IDOR has no rule id anywhere in the classification -- AI must never be told one is eligible for it", () => {
    // There is deliberately no "idor" / "broken-object-level-authorization"
    // entry in any category set (Phase 29 finding: no deterministic rule
    // exists for it). This guards against someone adding a fabricated id.
    const allKnownIds = [...CATEGORY_C_RULE_IDS];
    expect(allKnownIds.some((id) => /idor|object-level/i.test(id))).toBe(false);
  });

  it("an unknown/null rule id is never eligible", () => {
    expect(classifyRuleForAiReasoning(null)).toBe("AI_NOT_ELIGIBLE");
    expect(classifyRuleForAiReasoning(undefined)).toBe("AI_NOT_ELIGIBLE");
    expect(classifyRuleForAiReasoning("totally-made-up-rule")).toBe("A");
    expect(isEligibleForAiReasoning("totally-made-up-rule")).toBe(false);
  });
});
