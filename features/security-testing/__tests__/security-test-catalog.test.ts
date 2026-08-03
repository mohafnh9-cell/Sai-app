import { describe, expect, it } from "vitest";
import { buildFallbackSecurityTestOptions } from "../user-test-catalog";
import { mapSelectedTestsToHypotheses } from "@/server/attack-simulation/security-test-options";
import { namespaceTranslator } from "@/lib/i18n/review-progress";

const t = namespaceTranslator("en", "securityTest");

describe("security test UX catalog", () => {
  it("uses plain-language default tests", () => {
    const tests = buildFallbackSecurityTestOptions(t);
    expect(tests.length).toBeGreaterThan(0);
    expect(tests[0].title.toLowerCase()).not.toContain("red team");
    expect(tests[0].title).toContain("?");
  });

  it("maps selected catalog tests to hypotheses", () => {
    const hypotheses = mapSelectedTestsToHypotheses(["workflow-bypass"], []);
    expect(hypotheses).toHaveLength(1);
    expect(hypotheses[0].adapterHint).toBe("workflow-bypass");
  });
});
