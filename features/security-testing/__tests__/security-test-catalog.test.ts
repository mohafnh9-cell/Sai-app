import { describe, expect, it } from "vitest";
import { buildFallbackSecurityTestOptions } from "../user-test-catalog";
import { mapSelectedTestsToHypotheses } from "@/server/attack-simulation/security-test-options";

describe("security test UX catalog", () => {
  it("uses plain-language default tests", () => {
    const tests = buildFallbackSecurityTestOptions();
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
