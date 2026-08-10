import { describe, expect, it } from "vitest";
import { formatFullProductAuditResponse } from "../format-response";
import type { FullProductAuditResult } from "../types";

const t = ((key: string, params?: Record<string, string>) => {
  const map: Record<string, string> = {
    "fullProductAudit.intro": "SequrAI has completed a Full Product Audit — static code review plus security testing.",
    "fullProductAudit.productionReadiness": "Production Readiness",
    "fullProductAudit.securityScore": `Security Score: ${params?.score ?? "unavailable"}/100`,
    "fullProductAudit.scoreUnavailable": "unavailable",
    "fullProductAudit.severityCounts": `Critical: ${params?.critical} | High: ${params?.high}`,
    "fullProductAudit.verificationCounts": `Confirmed: ${params?.confirmed}`,
    "fullProductAudit.recommendationHeader": "SEQURAI RECOMMENDATION",
    "fullProductAudit.staticAnalysisHeader": "STATIC ANALYSIS",
    "fullProductAudit.staticAnalysisSummary": `Code review findings: ${params?.count}`,
    "fullProductAudit.dynamicTestingHeader": "DYNAMIC TESTING",
    "fullProductAudit.dynamicTestingSummary": `Security tests executed: ${params?.count} in ${params?.mode} mode.`,
    "fullProductAudit.dynamicTestingSkippedNoTarget": "SequrAI did not run dynamic attacks because no authorized target environment is configured.",
    "fullProductAudit.verifyFix": "VERIFY FIX",
  };
  return map[key] ?? key;
}) as never;

function baseResult(overrides: Partial<FullProductAuditResult>): FullProductAuditResult {
  return {
    mode: "full_product_audit",
    phase: "complete",
    project: { id: "p1", name: "Lab", repositoryFullName: null },
    reviewId: "scan-1",
    commitSha: "abc",
    verdictStatus: null,
    score: null,
    counts: {
      critical: 0,
      high: 1,
      medium: 0,
      low: 0,
      info: 0,
      confirmed: 1,
      likely: 0,
      potential: 0,
      notReproduced: 0,
      falsePositive: 0,
      notApplicable: 0,
    },
    topRisks: [],
    whatToFixFirst: [],
    findings: [],
    engines: {
      codeReview: { scanId: "scan-1", findingsCount: 3, rulesRun: 22 },
      securityTesting: {
        campaignId: "camp-1",
        executionsRun: 1,
        executionsCompleted: 1,
        adaptersExecuted: ["idor-cross-tenant"],
        adaptersSelectedFromFindings: ["idor-cross-tenant"],
        runtimeMode: "sandbox",
        dynamicTargetSource: "sandbox_lab",
        skippedReason: null,
      },
    },
    safeFixAvailable: false,
    safeFixBlockerId: null,
    recommendation: "Fix confirmed issues.",
    summary: "",
    timedOut: false,
    nextAction: "Re-run audit.",
    ...overrides,
  };
}

describe("formatFullProductAuditResponse", () => {
  it("separates STATIC ANALYSIS and DYNAMIC TESTING in MCP summary", () => {
    const formatted = formatFullProductAuditResponse(baseResult({}), t);
    expect(formatted.summary).toContain("STATIC ANALYSIS");
    expect(formatted.summary).toContain("DYNAMIC TESTING");
    expect(formatted.summary).toContain("sandbox");
  });

  it("explains when dynamic tests were skipped due to missing authorized target", () => {
    const formatted = formatFullProductAuditResponse(
      baseResult({
        engines: {
          codeReview: { scanId: "scan-1", findingsCount: 2, rulesRun: 22 },
          securityTesting: {
            campaignId: null,
            executionsRun: 0,
            executionsCompleted: 0,
            adaptersExecuted: [],
            adaptersSelectedFromFindings: [],
            runtimeMode: "mock",
            dynamicTargetSource: "none",
            skippedReason: null,
          },
        },
      }),
      t
    );
    expect(formatted.summary).toContain("DYNAMIC TESTING");
    expect(formatted.summary).toContain("no authorized target");
  });
});
