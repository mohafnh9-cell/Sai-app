import { describe, expect, it } from "vitest";
import { evaluateAttackOutcome, getMitigationTemplate } from "../mitigation/evaluate-outcome";
import { buildAttackFindingInput } from "../mitigation/build-finding";
import { buildAttackMitigationInput } from "../mitigation/build-mitigation";
import { buildAttackSafeFixInput } from "../mitigation/build-safe-fix";

describe("attack outcome oracle", () => {
  const scenario = {
    adapterId: "idor-cross-tenant",
    title: "Cross-tenant IDOR",
    category: "authorization",
  };

  it("marks mock exploit signals as potential, not confirmed", () => {
    const result = evaluateAttackOutcome({
      evidence: {
        confidence: 0.7,
        expectedBehavior: "Tenant A should not read tenant B records",
        observedBehavior: "Returned tenant B record for cross-tenant request",
        sideEffects: {},
        statusCode: 200,
      },
      scenario,
      runtimeMode: "mock",
    });
    expect(result.confirmationStatus).toBe("potential");
    expect(result.outcome).toBe("inconclusive");
    expect(result.exploitable).toBe(true);
    expect(result.severity).toBe("high");
  });

  it("marks not exploitable when protection signals dominate", () => {
    const result = evaluateAttackOutcome({
      evidence: {
        confidence: 0.7,
        expectedBehavior: "Unauthorized access denied",
        observedBehavior: "403 forbidden for cross-tenant request",
        sideEffects: {},
        statusCode: 403,
      },
      scenario,
      executionBlocked: true,
      runtimeMode: "mock",
    });
    expect(result.outcome).toBe("not_exploitable");
    expect(result.exploitable).toBe(false);
  });
});

describe("attack mitigation and safe fix builders", () => {
  it("builds finding, mitigation, and safe fix linked by attackFindingId", () => {
    const template = getMitigationTemplate("idor-cross-tenant");
    const evaluation = {
      outcome: "inconclusive" as const,
      confirmationStatus: "potential" as const,
      severity: "high" as const,
      impact: "Cross-tenant access potential",
      rootCause: template.rootCause,
      rationale: "Matched exploit signals",
      exploitable: true,
      exploitSignalHits: 2,
      protectionSignalHits: 0,
    };

    const findingInput = buildAttackFindingInput({
      campaign: {
        id: "11111111-1111-4111-8111-111111111111",
        organizationId: "66666666-6666-4666-8666-666666666666",
        projectId: "55555555-5555-4555-8555-555555555555",
        runtimeMode: "mock",
      },
      execution: { id: "22222222-2222-4222-8222-222222222222" },
      scenario: {
        id: "44444444-4444-4444-8444-444444444444",
        title: "Cross-tenant IDOR",
        description: "Simulated cross-tenant access",
        category: "authorization",
        hypothesisId: "hyp-1",
        adapterId: "idor-cross-tenant",
      },
      evidence: {
        id: "99999999-9999-4999-8999-999999999999",
        confidence: 0.72,
        expectedBehavior: "Denied",
        observedBehavior: "cross-tenant",
        statusCode: 200,
        sideEffects: {},
        reproducibility: "deterministic",
        redactedRequest: {},
        redactedResponse: {},
      },
      evaluation,
      runtimeMode: "mock",
      projectFilePaths: ["app/api/users/route.ts"],
    });

    expect(findingInput.outcome).toBe("inconclusive");
    expect(findingInput.metadata.exploitable).toBe(true);
    expect(findingInput.metadata.evidenceReport).toBeTruthy();

    const mitigationInput = buildAttackMitigationInput({
      finding: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        executionId: "22222222-2222-4222-8222-222222222222",
        campaignId: "11111111-1111-4111-8111-111111111111",
        organizationId: "66666666-6666-4666-8666-666666666666",
        projectId: "55555555-5555-4555-8555-555555555555",
        rootCause: template.rootCause,
        metadata: findingInput.metadata,
      },
      scenario: { adapterId: "idor-cross-tenant", title: "Cross-tenant IDOR" },
      evidence: { confidence: 0.72, replayInstructions: {}, reproducibility: "deterministic" },
      projectFilePaths: ["app/api/users/route.ts"],
    });

    expect(mitigationInput.likelyAffectedFiles.some((path) => path.includes("app/api"))).toBe(true);
    expect(mitigationInput.plainLanguageExplanation).toContain("Potential vulnerability");

    const safeFixInput = buildAttackSafeFixInput({
      finding: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        executionId: "22222222-2222-4222-8222-222222222222",
        campaignId: "11111111-1111-4111-8111-111111111111",
        organizationId: "66666666-6666-4666-8666-666666666666",
        projectId: "55555555-5555-4555-8555-555555555555",
        title: "Cross-tenant IDOR",
        description: "Potential issue",
        impact: "Impact",
        rootCause: template.rootCause,
      },
      mitigation: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        implementationRisk: "medium",
        safeFixConfidence: 0.8,
        estimatedLoc: 40,
        plainLanguageExplanation: mitigationInput.plainLanguageExplanation,
        recommendedProtection: mitigationInput.recommendedProtection,
        implementationSteps: mitigationInput.implementationSteps,
        likelyAffectedFiles: mitigationInput.likelyAffectedFiles,
        rollbackGuidance: mitigationInput.rollbackGuidance,
        residualRisk: mitigationInput.residualRisk,
      },
      scenario: { adapterId: "idor-cross-tenant", title: "Cross-tenant IDOR" },
    });

    expect(safeFixInput.metadata.attackFindingId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });
});
