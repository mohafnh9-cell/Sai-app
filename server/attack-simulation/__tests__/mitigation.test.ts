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

  it("confirms exploit when signals match evidence", () => {
    const result = evaluateAttackOutcome({
      evidence: {
        confidence: 0.7,
        expectedBehavior: "Tenant A should not read tenant B records",
        observedBehavior: "Returned tenant B record for cross-tenant request",
        sideEffects: {},
        statusCode: 200,
      },
      scenario,
    });
    expect(result.outcome).toBe("confirmed");
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
    });
    expect(result.outcome).toBe("not_exploitable");
    expect(result.exploitable).toBe(false);
  });
});

describe("attack mitigation and safe fix builders", () => {
  it("builds finding, mitigation, and safe fix linked by attackFindingId", () => {
    const template = getMitigationTemplate("idor-cross-tenant");
    const evaluation = {
      outcome: "confirmed" as const,
      severity: "high" as const,
      impact: "Cross-tenant access confirmed",
      rootCause: template.rootCause,
      rationale: "Matched exploit signals",
      exploitable: true,
    };

    const findingInput = buildAttackFindingInput({
      campaign: {
        id: "11111111-1111-4111-8111-111111111111",
        organizationId: "66666666-6666-4666-8666-666666666666",
        projectId: "55555555-5555-4555-8555-555555555555",
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
      evidence: { id: "99999999-9999-4999-8999-999999999999", confidence: 0.72 },
      evaluation,
    });

    expect(findingInput.outcome).toBe("confirmed");
    expect(findingInput.metadata.exploitable).toBe(true);

    const finding = {
      ...findingInput,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };

    const mitigationInput = buildAttackMitigationInput({
      finding,
      scenario: { adapterId: "idor-cross-tenant", title: "Cross-tenant IDOR" },
      evidence: {
        confidence: 0.72,
        replayInstructions: "Re-run adapter",
        reproducibility: "commit=abc",
      },
    });

    expect(mitigationInput.recommendedProtection).toContain("tenant-scoped");

    const mitigation = {
      ...mitigationInput,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    };

    const safeFixInput = buildAttackSafeFixInput({
      finding,
      mitigation,
      scenario: { adapterId: "idor-cross-tenant", title: "Cross-tenant IDOR" },
    });

    expect(safeFixInput.status).toBe("ready");
    expect(safeFixInput.metadata.attackFindingId).toBe(finding.id);
    expect(safeFixInput.cursorPrompt).toContain(finding.id);
    expect(safeFixInput.cursorPrompt).toContain("tenant-scoped");
  });
});
