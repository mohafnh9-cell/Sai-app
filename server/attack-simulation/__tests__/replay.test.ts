import { describe, expect, it } from "vitest";
import { compareProtectionEvidence } from "../replay/compare-evidence";

describe("protection evidence comparison", () => {
  const scenario = { adapterId: "idor-cross-tenant" };

  const originalEvidence = {
    id: "11111111-1111-4111-8111-111111111111",
    executionId: "22222222-2222-4222-8222-222222222222",
    campaignId: "33333333-3333-4333-8333-333333333333",
    scenarioId: "44444444-4444-4444-8444-444444444444",
    organizationId: "66666666-6666-4666-8666-666666666666",
    projectId: "55555555-5555-4555-8555-555555555555",
    commitSha: "67e0cc53e3dbc4dcd04bb4a8ab3220eb453d5f1b",
    environment: "mock" as const,
    expectedBehavior: "Tenant A cannot read tenant B records",
    observedBehavior: "Returned tenant B record for cross-tenant request",
    redactedRequest: {},
    redactedResponse: {},
    statusCode: 200,
    sideEffects: {},
    preconditions: {},
    attackProfile: {},
    protectedAssets: [],
    reproducibility: "commit=abc",
    confidence: 0.72,
    replayInstructions: "Re-run adapter",
    capturedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  it("marks protected when replay shows denial signals", () => {
    const replayEvidence = {
      ...originalEvidence,
      id: "99999999-9999-4999-8999-999999999999",
      observedBehavior: "403 forbidden for cross-tenant request",
      statusCode: 403,
      confidence: 0.68,
    };

    const result = compareProtectionEvidence({
      originalEvidence,
      replayEvidence,
      scenario,
      originalFindingConfirmed: true,
    });

    expect(result.outcome).toBe("protected");
    expect(result.comparison.replayProtectionSignals).toBeGreaterThan(0);
  });

  it("marks still_vulnerable when replay keeps exploit indicators", () => {
    const replayEvidence = {
      ...originalEvidence,
      id: "99999999-9999-4999-8999-999999999999",
      observedBehavior: "Returned tenant B record again",
      statusCode: 200,
    };

    const result = compareProtectionEvidence({
      originalEvidence,
      replayEvidence,
      scenario,
      originalFindingConfirmed: true,
    });

    expect(result.outcome).toBe("still_vulnerable");
  });

  it("returns inconclusive when original was not exploitable", () => {
    const replayEvidence = {
      ...originalEvidence,
      id: "99999999-9999-4999-8999-999999999999",
      observedBehavior: "403 forbidden",
      statusCode: 403,
    };

    const result = compareProtectionEvidence({
      originalEvidence: {
        ...originalEvidence,
        observedBehavior: "403 forbidden on first run",
        confidence: 0.4,
      },
      replayEvidence,
      scenario,
      originalFindingConfirmed: false,
    });

    expect(result.outcome).toBe("inconclusive");
  });
});
