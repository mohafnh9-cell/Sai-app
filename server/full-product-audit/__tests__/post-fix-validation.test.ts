import { describe, expect, it } from "vitest";
import { compareAuditForPostFix } from "../post-fix-validation";
import type { ConsolidatedAuditFinding } from "../types";

function finding(
  partial: Partial<ConsolidatedAuditFinding> & Pick<ConsolidatedAuditFinding, "id" | "title">
): ConsolidatedAuditFinding {
  return {
    severity: "high",
    category: "authorization",
    description: partial.title,
    source: "both",
    verificationStatus: "CONFIRMED",
    evidence: [],
    confidence: "high",
    affectedComponent: null,
    recommendation: null,
    safeFixAvailable: true,
    ...partial,
  };
}

describe("compareAuditForPostFix", () => {
  it("returns FIXED when confirmed finding disappears after fix", () => {
    const status = compareAuditForPostFix({
      before: [
        finding({
          id: "1",
          title: "IDOR",
          ruleId: "authz.insufficient",
          staticFindingId: "sf1",
          verificationStatus: "CONFIRMED",
        }),
      ],
      after: [],
      targetRuleIds: ["authz.insufficient"],
    });
    expect(status).toBe("FIXED");
  });

  it("returns STILL_VULNERABLE when confirmed finding persists", () => {
    const status = compareAuditForPostFix({
      before: [
        finding({
          id: "1",
          title: "IDOR",
          ruleId: "authz.insufficient",
          verificationStatus: "CONFIRMED",
        }),
      ],
      after: [
        finding({
          id: "1",
          title: "IDOR",
          ruleId: "authz.insufficient",
          verificationStatus: "CONFIRMED",
        }),
      ],
      targetRuleIds: ["authz.insufficient"],
    });
    expect(status).toBe("STILL_VULNERABLE");
  });
});
