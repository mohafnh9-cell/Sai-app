import { describe, expect, it } from "vitest";
import { generateProductionVerdict } from "@/brain/production-verdict/engine";
import { isCriticalSignal, normalizeFinding } from "@/brain/production-verdict/normalize-finding";
import { determineVerdictStatus } from "@/brain/production-verdict/status-rules";
import { SECRET_CLASSIFICATION_METADATA_KEY } from "@/features/security-scanner/rules/secret-classification";
import {
  buildAuditFindingUserFacing,
  buildWhatToFixFirstEntries,
} from "@/server/full-product-audit/finding-user-copy";
import { isProductionBlockingAuditFinding } from "@/server/full-product-audit/correlate-findings";
import type { ConsolidatedAuditFinding } from "@/server/full-product-audit/types";

function secretFinding(
  classification: string,
  severity: "critical" | "high" | "info" = "high"
) {
  return {
    id: `secret-${classification}`,
    title: "Hard-coded secret",
    severity,
    category: "secrets",
    rule_id: "secrets.exposed",
    file_path: "app/auth/callback/__tests__/route.test.ts",
    start_line: 34,
    confidence: severity === "info" ? "low" : "high",
    metadata: { [SECRET_CLASSIFICATION_METADATA_KEY]: classification },
  };
}

function auditFinding(
  overrides: Partial<ConsolidatedAuditFinding> & Pick<ConsolidatedAuditFinding, "id" | "title">
): ConsolidatedAuditFinding {
  return {
    severity: "high",
    category: "secrets",
    description: "desc",
    source: "code_review",
    verificationStatus: "POTENTIAL",
    evidence: ["Static: token=[REDACTED]"],
    confidence: "medium",
    affectedComponent: "app/route.ts",
    recommendation: "Rotate",
    safeFixAvailable: false,
    ...overrides,
  };
}

describe("secret classification production verdict impact", () => {
  it("stale high-severity test fixture rows no longer block the verdict", () => {
    const normalized = normalizeFinding({
      id: "stale-secret",
      title: "Hard-coded secret",
      severity: "high",
      category: "secrets",
      rule_id: "secrets.exposed",
      file_path: "app/auth/callback/__tests__/route.test.ts",
      evidence: "providerToken=[REDACTED]",
      confidence: "high",
    });
    expect(normalized.secretClassification).toBe("TEST_FIXTURE");
    expect(normalized.severity).toBe("info");
    expect(isCriticalSignal(normalized)).toBe(false);
    const verdict = generateProductionVerdict({
      projectId: "11111111-1111-4111-8111-111111111111",
      repositoryId: "11111111-1111-4111-8111-111111111111",
      scanId: "22222222-2222-4222-8222-222222222222",
      scanStatus: "completed",
      securityScore: 95,
      filesAnalyzed: 50,
      findings: [
        {
          id: "stale-secret",
          title: "Hard-coded secret",
          severity: "high",
          category: "secrets",
          rule_id: "secrets.exposed",
          file_path: "app/auth/callback/__tests__/route.test.ts",
          evidence: "providerToken=[REDACTED]",
          confidence: "high",
        },
      ],
    }).verdict;
    expect(verdict.status).toBe("ready_to_ship");
    expect(verdict.blockersCount).toBe(0);
  });

  it("TEST_FIXTURE does not create production blocker", () => {
    const normalized = normalizeFinding(secretFinding("TEST_FIXTURE", "info"));
    expect(isCriticalSignal(normalized)).toBe(false);
    const verdict = generateProductionVerdict({
      projectId: "11111111-1111-4111-8111-111111111111",
      repositoryId: "11111111-1111-4111-8111-111111111111",
      scanId: "22222222-2222-4222-8222-222222222222",
      scanStatus: "completed",
      securityScore: 95,
      filesAnalyzed: 50,
      findings: [secretFinding("TEST_FIXTURE", "info")],
    }).verdict;
    expect(verdict.status).toBe("ready_to_ship");
  });

  it("PLACEHOLDER does not create production blocker", () => {
    expect(isCriticalSignal(normalizeFinding(secretFinding("PLACEHOLDER", "info")))).toBe(false);
  });

  it("FALSE_POSITIVE does not create production blocker", () => {
    expect(isCriticalSignal(normalizeFinding(secretFinding("FALSE_POSITIVE", "info")))).toBe(false);
  });

  it("labels POTENTIAL clearly in user-facing copy", () => {
    const copy = buildAuditFindingUserFacing(
      auditFinding({
        id: "1",
        title: "Hard-coded secret",
        verificationStatus: "POTENTIAL",
      })
    );
    expect(copy.confidenceLabel).toContain("Potencial");
  });

  it("labels CONFIRMED clearly in user-facing copy", () => {
    const copy = buildAuditFindingUserFacing(
      auditFinding({
        id: "1",
        title: "IDOR",
        verificationStatus: "CONFIRMED",
        source: "both",
      })
    );
    expect(copy.confidenceLabel).toBe("Confirmado");
  });

  it("explains dynamic not tested", () => {
    const copy = buildAuditFindingUserFacing(
      auditFinding({
        id: "1",
        title: "Hard-coded secret",
        ruleId: "secrets.exposed",
      })
    );
    expect(copy.dynamicVerificationStatus).toBe("No probado");
    expect(copy.dynamicVerificationReason).toContain("prueba dinámica segura");
  });

  it("explains dynamic blocked scope without calling it a vulnerability", () => {
    const copy = buildAuditFindingUserFacing(
      auditFinding({
        id: "1",
        title: "Missing guard",
        evidence: ["Static: x", "Dynamic blocked: BLOCKED_SCOPE"],
      })
    );
    expect(copy.dynamicVerificationStatus).toBe("Bloqueado");
  });

  it("explains dynamic confirmed", () => {
    const copy = buildAuditFindingUserFacing(
      auditFinding({
        id: "1",
        title: "IDOR",
        verificationStatus: "CONFIRMED",
        source: "both",
      })
    );
    expect(copy.dynamicVerificationStatus).toBe("Confirmado");
  });

  it("separates static and dynamic in user-facing explanations", () => {
    const potential = buildAuditFindingUserFacing(
      auditFinding({ id: "1", title: "Secret", verificationStatus: "POTENTIAL" })
    );
    const confirmed = buildAuditFindingUserFacing(
      auditFinding({ id: "2", title: "IDOR", verificationStatus: "CONFIRMED", source: "both" })
    );
    expect(potential.simpleExplanation).not.toContain("confirm");
    expect(confirmed.simpleExplanation).toContain("evidencia estática y dinámica");
  });

  it("keeps technical evidence accessible but user copy stays simple", () => {
    const finding = auditFinding({
      id: "1",
      title: "Secret",
      staticFindingId: "sf-1",
      adapterId: "headers-probe",
    });
    expect(finding.staticFindingId).toBe("sf-1");
    expect(buildAuditFindingUserFacing(finding).simpleExplanation).not.toContain("sf-1");
  });

  it("ranks actionable issues first in what to fix", () => {
    const ranked = buildWhatToFixFirstEntries([
      enrichAudit(
        auditFinding({
          id: "fixture",
          title: "Hard-coded secret",
          severity: "info",
          secretClassification: "TEST_FIXTURE",
        })
      ),
      enrichAudit(
        auditFinding({
          id: "real",
          title: "Hard-coded secret",
          severity: "high",
          verificationStatus: "POTENTIAL",
        })
      ),
    ]);
    expect(ranked[0]).toContain("Hard-coded secret");
    expect(ranked[0]).toContain("prioridad alta");
  });

  it("REAL_SECRET still blocks verdict", () => {
    const status = determineVerdictStatus({
      scanStatus: "completed",
      score: 86,
      criticalBlockersCount: 0,
      highBlockersCount: 1,
      hasSufficientCoverage: true,
      findings: [normalizeFinding(secretFinding("REAL_SECRET", "high"))],
    });
    expect(status).toBe("not_ready");
  });

  it("audit helper excludes test fixtures from production blocking", () => {
    expect(
      isProductionBlockingAuditFinding(
        auditFinding({
          id: "1",
          title: "Hard-coded secret",
          severity: "info",
          secretClassification: "TEST_FIXTURE",
        })
      )
    ).toBe(false);
  });
});

function enrichAudit(finding: ConsolidatedAuditFinding): ConsolidatedAuditFinding {
  return { ...finding, userFacing: buildAuditFindingUserFacing(finding) };
}
