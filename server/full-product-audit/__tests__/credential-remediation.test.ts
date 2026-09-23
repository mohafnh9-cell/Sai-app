import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { formatFullProductAuditResponse } from "../format-response";
import { buildAuditFindingUserFacing } from "../finding-user-copy";
import {
  isCoverageBaselineFinding,
  isCredentialFinding,
  requiresCredentialRemediation,
} from "../finding-classification";
import type { ConsolidatedAuditFinding, FullProductAuditResult } from "../types";

// Pass 4 HIGH-006: credential remediation (remove / rotate) must come from a
// structured secret-rule finding, never from a title or category substring.
// A coverage baseline titled "secrets coverage evaluated" is not a credential.

const t = ((key: string) => key) as never;
const REMOVE = "fullProductAudit.report.nextRemoveSecret";
const ROTATE = "fullProductAudit.report.nextRotateSecret";

function finding(overrides: Partial<ConsolidatedAuditFinding>): ConsolidatedAuditFinding {
  return {
    id: "f1",
    severity: "info",
    category: "architecture",
    title: "finding",
    description: "d",
    source: "code_review",
    verificationStatus: "NOT_APPLICABLE",
    evidence: [],
    confidence: "medium",
    confidenceLevel: "INFERRED",
    affectedComponent: "src/x.ts",
    recommendation: null,
    safeFixAvailable: false,
    ...overrides,
  } as ConsolidatedAuditFinding;
}

function result(findings: ConsolidatedAuditFinding[]): FullProductAuditResult {
  const enriched = findings.map((f) => ({ ...f, userFacing: buildAuditFindingUserFacing(f) }));
  return {
    mode: "full_product_audit",
    phase: "complete",
    project: { id: "p", name: "P", repositoryFullName: null },
    reviewId: "scan",
    commitSha: "abc",
    verdictStatus: "insufficient_data",
    score: 100,
    counts: {
      critical: 0, high: 0, medium: 0, low: 0, info: findings.length,
      confirmed: 0, likely: 0, potential: 0, notReproduced: 0, falsePositive: 0, notApplicable: 0,
    },
    topRisks: [],
    whatToFixFirst: [],
    findings: enriched,
    engines: {
      codeReview: { scanId: "scan", findingsCount: findings.length, rulesRun: 47 },
      securityTesting: {
        campaignId: null, executionsRun: 0, executionsCompleted: 0, adaptersExecuted: [],
        adaptersSelectedFromFindings: [], runtimeMode: null, dynamicTargetSource: null,
        skippedReason: null, notSafelyTestableCount: 0,
      },
    },
    dynamicVerification: {
      offered: false, decision: null, authorizedTarget: null, awaitingUrl: false,
      awaitingAuthorization: false, awaitingScopeApproval: false, notSafelyTestableCount: 0,
    },
    safeFixAvailable: false,
    safeFixBlockerId: null,
    recommendation: "r",
    summary: "",
    timedOut: false,
    nextAction: "n",
  } as FullProductAuditResult;
}

function summaryFor(findings: ConsolidatedAuditFinding[]): string {
  return formatFullProductAuditResponse(result(findings), t).summary;
}

describe("credential remediation is driven by structured rule ids", () => {
  it("1: 'secrets coverage evaluated' baseline does not produce credential remediation", () => {
    const summary = summaryFor([
      finding({ title: "secrets coverage evaluated", ruleId: "security.area-baseline", category: "architecture" }),
    ]);
    expect(summary).not.toContain(REMOVE);
    expect(summary).not.toContain(ROTATE);
  });

  it("2: a real secrets.exposed finding allows credential remediation", () => {
    const summary = summaryFor([
      finding({ title: "Hard-coded secret", ruleId: "secrets.exposed", category: "secrets", severity: "high" }),
    ]);
    expect(summary).toContain(REMOVE);
    expect(summary).toContain(ROTATE);
  });

  it("3: a real secrets.public-env finding allows credential remediation", () => {
    const summary = summaryFor([
      finding({ title: "Secret exposed via public env", ruleId: "secrets.public-env", category: "secrets", severity: "high" }),
    ]);
    expect(summary).toContain(REMOVE);
  });

  it("4: an info coverage baseline never produces credential remediation", () => {
    const summary = summaryFor([
      finding({ title: "dependencies coverage evaluated", ruleId: "readiness.area-baseline", severity: "info" }),
    ]);
    expect(summary).not.toContain(REMOVE);
  });

  it("5: a title containing 'secret' with an unrelated rule does not produce credential remediation", () => {
    const summary = summaryFor([
      finding({ title: "Secret handling documentation missing", ruleId: "docs.missing", category: "documentation", severity: "low" }),
    ]);
    expect(summary).not.toContain(REMOVE);
    expect(summary).not.toContain(ROTATE);
  });

  it("6: a title containing 'credential' with an unrelated rule does not produce credential remediation", () => {
    const summary = summaryFor([
      finding({ title: "Credential UI copy", ruleId: "ux.copy", category: "secrets", severity: "medium" }),
    ]);
    expect(summary).not.toContain(REMOVE);
  });

  it("7: no findings produce no credential remediation", () => {
    const summary = summaryFor([]);
    expect(summary).not.toContain(REMOVE);
    expect(summary).not.toContain(ROTATE);
  });

  it("8: only findings of the audited scan are formatted, so a secret from another scan is never presented as current", () => {
    // The audit is bound to one scan (CRIT-003); a historical secret finding is not part of
    // this result and therefore cannot drive remediation for it.
    const summary = summaryFor([finding({ ruleId: "security.area-baseline", title: "api coverage evaluated" })]);
    expect(summary).not.toContain(REMOVE);
  });

  it("a secret finding classified as a test fixture does not ask the user to rotate anything", () => {
    const summary = summaryFor([
      finding({ ruleId: "secrets.exposed", category: "secrets", title: "Hard-coded secret", secretClassification: "TEST_FIXTURE" }),
    ]);
    expect(summary).not.toContain(ROTATE);
  });
});

describe("user-facing wording is not credential wording for non-credential findings", () => {
  it("a coverage baseline is described as coverage information, not a credential", () => {
    const copy = buildAuditFindingUserFacing(
      finding({ title: "secrets coverage evaluated", ruleId: "security.area-baseline" })
    );
    expect(copy.simpleExplanation).not.toMatch(/credencial/i);
    expect(copy.whyItMatters).not.toMatch(/credencial/i);
    expect(copy.simpleExplanation).toMatch(/cobertura/i);
  });

  it("an unrelated finding gets neutral wording", () => {
    const copy = buildAuditFindingUserFacing(finding({ title: "Missing rate limit", ruleId: "api.rate-limit", severity: "medium" }));
    expect(copy.simpleExplanation).not.toMatch(/credencial/i);
  });

  it("a genuine secret finding keeps the credential wording", () => {
    const copy = buildAuditFindingUserFacing(finding({ ruleId: "secrets.exposed", category: "secrets", severity: "high" }));
    expect(copy.simpleExplanation).toMatch(/credencial/i);
  });
});

describe("classifier", () => {
  it("is case-insensitive on rule ids and never reads titles", () => {
    expect(isCredentialFinding({ ruleId: "SECRETS.EXPOSED" })).toBe(true);
    expect(isCoverageBaselineFinding({ ruleId: "Security.Area-Baseline" })).toBe(true);
    expect(requiresCredentialRemediation({ ruleId: undefined })).toBe(false);
  });
});
