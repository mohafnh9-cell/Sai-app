import { describe, expect, it } from "vitest";
import {
  deriveExploitability,
  fromConsolidatedAuditFinding,
  mapLegacyVerificationStatus,
} from "../canonical-finding";
import type { ConsolidatedAuditFinding } from "@/server/full-product-audit/types";

describe("Phase 34 -- mapLegacyVerificationStatus", () => {
  it("maps every legacy FindingVerificationStatus value to a canonical one", () => {
    expect(mapLegacyVerificationStatus("CONFIRMED")).toBe("CONFIRMED");
    expect(mapLegacyVerificationStatus("LIKELY")).toBe("LIKELY");
    expect(mapLegacyVerificationStatus("POTENTIAL")).toBe("POTENTIAL");
    expect(mapLegacyVerificationStatus("NOT_REPRODUCED")).toBe("UNVERIFIED");
    expect(mapLegacyVerificationStatus("FALSE_POSITIVE")).toBe("FALSE_POSITIVE");
    expect(mapLegacyVerificationStatus("NOT_APPLICABLE")).toBe("NOT_APPLICABLE");
    expect(mapLegacyVerificationStatus("UNVERIFIED")).toBe("UNVERIFIED");
  });
});

describe("Phase 34 -- deriveExploitability (rules from the Phase 34 brief, section 4/5)", () => {
  it("a static finding alone (POTENTIAL, no evidence) never reaches HIGH/CRITICAL or high confidence", () => {
    const result = deriveExploitability({ verificationStatus: "POTENTIAL", severity: "critical", evidence: [] });
    expect(result.level).toBe("LOW");
    expect(result.confidence).toBeLessThan(0.5);
  });

  it("AI suspicion alone (UNVERIFIED) is never treated as a confirmed exploit", () => {
    const result = deriveExploitability({ verificationStatus: "UNVERIFIED", severity: "high", evidence: [] });
    expect(result.level).toBe("UNKNOWN");
  });

  it("a false positive always resolves to UNKNOWN / zero confidence regardless of severity", () => {
    const result = deriveExploitability({
      verificationStatus: "FALSE_POSITIVE",
      severity: "critical",
      evidence: [{ id: "e1", kind: "DYNAMIC_TEST", label: "x", capturedAt: new Date().toISOString() }],
    });
    expect(result.level).toBe("UNKNOWN");
    expect(result.confidence).toBe(0);
  });

  it("CONFIRMED with runtime evidence produces HIGH or CRITICAL, never lower", () => {
    const evidence = [
      { id: "e1", kind: "DYNAMIC_TEST" as const, label: "cross-user object access", capturedAt: new Date().toISOString() },
    ];
    const high = deriveExploitability({ verificationStatus: "CONFIRMED", severity: "high", evidence });
    const critical = deriveExploitability({ verificationStatus: "CONFIRMED", severity: "critical", evidence });
    expect(high.level).toBe("HIGH");
    expect(critical.level).toBe("CRITICAL");
    expect(high.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("evidenceIds on the result always trace back to the evidence actually passed in", () => {
    const evidence = [
      { id: "e1", kind: "DYNAMIC_TEST" as const, label: "x", capturedAt: new Date().toISOString() },
      { id: "e2", kind: "HTTP_RESPONSE" as const, label: "y", capturedAt: new Date().toISOString() },
    ];
    const result = deriveExploitability({ verificationStatus: "CONFIRMED", severity: "high", evidence });
    expect(result.evidenceIds).toEqual(["e1", "e2"]);
  });
});

function consolidatedFinding(overrides: Partial<ConsolidatedAuditFinding> = {}): ConsolidatedAuditFinding {
  return {
    id: "confirmed:static-1:attack-1",
    severity: "high",
    category: "authorization",
    title: "IDOR in /api/projects/:id",
    description: "User A can access User B's project via a predictable object id.",
    source: "both",
    verificationStatus: "CONFIRMED",
    evidence: [
      "Static: weak authorization check at server/projects/route.ts:42",
      "Dynamic (idor-cross-tenant): confirmed — User A retrieved User B's data",
    ],
    confidence: "high",
    confidenceLevel: "VERIFIED",
    affectedComponent: "server/projects/route.ts",
    line: 42,
    recommendation: "Scope every project lookup by the authenticated user's organization_id.",
    safeFixAvailable: true,
    staticFindingId: "static-1",
    attackFindingId: "attack-1",
    ...overrides,
  };
}

describe("Phase 34 -- fromConsolidatedAuditFinding", () => {
  it("maps a CONFIRMED, dual-source finding into the canonical shape with both sources and CRITICAL/HIGH exploitability", () => {
    const ctx = { scanId: "scan-1", projectId: "project-1", organizationId: "org-1" };
    const result = fromConsolidatedAuditFinding(consolidatedFinding(), ctx);

    expect(result.verificationStatus).toBe("CONFIRMED");
    expect(result.sources).toEqual(expect.arrayContaining(["native_scanner", "dynamic_test"]));
    expect(result.exploitability.level).toBe("HIGH");
    expect(result.evidence).toHaveLength(2);
    expect(result.scanId).toBe("scan-1");
    expect(result.organizationId).toBe("org-1");
    expect(result.fingerprint).toBe("static-1");
  });

  it("a POTENTIAL (code_review-only) finding is never treated as exploit-confirmed", () => {
    const ctx = { scanId: "scan-1", projectId: "project-1", organizationId: "org-1" };
    const result = fromConsolidatedAuditFinding(
      consolidatedFinding({
        source: "code_review",
        verificationStatus: "POTENTIAL",
        evidence: ["Static rule SEC-001 at server/foo.ts"],
      }),
      ctx
    );
    expect(result.verificationStatus).toBe("POTENTIAL");
    expect(result.exploitability.level).not.toBe("HIGH");
    expect(result.exploitability.level).not.toBe("CRITICAL");
    expect(result.sources).toEqual(["native_scanner"]);
  });
});
