import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatFullProductAuditResponse } from "../format-response";
import { buildRecommendation } from "../orchestrate";
import type { FullProductAuditResult } from "../types";
import { getMcpTranslator } from "@/server/mcp/i18n";
import { verdictAffirmsDeploy } from "@/brain/production-verdict/deployment-posture";
import { containsApprovalLanguage } from "@/brain/production-verdict/narrative-guard";
import { PRODUCTION_VERDICT_VERSION, type ProductionVerdictV1 } from "@/brain/production-verdict/schema";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const area = (key: string) => ({ key, label: key, score: null, status: "not_evaluated", confidence: "low", limitations: "", methodology: "", evidenceCount: 0 });
function verdict(over: Partial<ProductionVerdictV1>): ProductionVerdictV1 {
  return {
    version: PRODUCTION_VERDICT_VERSION, projectId: uuid(1), repositoryId: uuid(1), scanId: uuid(2), commitSha: "ea2371b", branch: "main",
    status: "ready_to_ship", score: 100, previousScore: null, scoreDelta: null, projectedScore: 100, projectedScoreIsEstimate: true,
    blockersCount: 0, criticalBlockersCount: 0, highBlockersCount: 0, estimatedFixMinutes: 0, confidence: "high", executiveSummary: "s",
    topPriorities: [], evaluatedAreas: [], partiallyEvaluatedAreas: [], unevaluatedAreas: [], introducedBlockers: 0, resolvedBlockers: 0,
    coverageRatio: 1, filesAnalyzed: 24, findingsCount: 0, recommendedAction: "r", methodologyNote: "m", generatedAt: "2026-10-07T10:38:47.725Z", ...over,
  } as ProductionVerdictV1;
}

const ZERO = { critical: 0, high: 0, medium: 0, low: 0, info: 0, confirmed: 0, likely: 0, potential: 0, notReproduced: 0, falsePositive: 0, notApplicable: 0 };

/** Builds the result exactly the way the orchestrator does: affirmsDeploy and recommendation come from the canonical gate. */
function resultFor(v: ProductionVerdictV1 | null, counts = ZERO): FullProductAuditResult {
  const affirmsDeploy = v ? verdictAffirmsDeploy(v) : false;
  const verdictStatus = v?.status ?? null;
  return {
    mode: "full_product_audit", phase: "complete", project: { id: "p1", name: "Lab", repositoryFullName: null }, reviewId: "scan-1", commitSha: "abc",
    verdictStatus, affirmsDeploy, score: v?.score ?? null, counts, topRisks: [], whatToFixFirst: [], findings: [],
    engines: {
      codeReview: { scanId: "scan-1", findingsCount: 0, rulesRun: 22 },
      securityTesting: { campaignId: null, executionsRun: 0, executionsCompleted: 0, adaptersExecuted: [], adaptersSelectedFromFindings: [], runtimeMode: "mock", dynamicTargetSource: "none", skippedReason: null, notSafelyTestableCount: 0 },
    },
    dynamicVerification: { offered: false, decision: null, authorizedTarget: null, awaitingUrl: false, awaitingAuthorization: false, awaitingScopeApproval: false, notSafelyTestableCount: 0 },
    safeFixAvailable: false, safeFixBlockerId: null,
    recommendation: buildRecommendation({ verdictStatus, affirmsDeploy, topRisks: [], counts }),
    summary: "", timedOut: false, nextAction: "Re-run audit.",
  } as FullProductAuditResult;
}

const READY = () => verdict({});
const LIMITED = () => verdict({ confidence: "low", unevaluatedAreas: [area("testing")] as never });
const MEDIUM_INCOMPLETE = () => verdict({ confidence: "medium", unevaluatedAreas: [area("performance")] as never });
const NOT_READY = () => verdict({ status: "not_ready", score: 0, confidence: "low", blockersCount: 10, criticalBlockersCount: 1, highBlockersCount: 9 });
const INSUFFICIENT = () => verdict({ status: "insufficient_data", score: null, confidence: "low" });
const FAILED = () => verdict({ status: "analysis_failed", score: null, confidence: "low" });

const APPROVED_HEADLINE = /^READY TO SHIP$/m;
const approvedHeadlineCount = (s: string) => (s.match(/^READY TO SHIP$/gm) ?? []).length;
const summaryOf = (r: FullProductAuditResult, locale: "en" | "es") => formatFullProductAuditResponse(r, getMcpTranslator(locale)).summary;

describe.each(["en", "es"] as const)("Full Product Audit headline derives from the canonical approval gate [%s]", (locale) => {
  it("1. genuine READY (ready_to_ship + affirmsDeploy): READY TO SHIP in both headline positions", () => {
    const r = resultFor(READY());
    expect(r.affirmsDeploy).toBe(true);
    const s = summaryOf(r, locale);
    expect(approvedHeadlineCount(s)).toBe(2);
    expect(s).toMatch(/Ship when your release process is ready/);
  });

  it("2. evidence-limited ready_to_ship (affirmsDeploy=false): evidence-limited headline, never READY TO SHIP", () => {
    for (const v of [LIMITED(), MEDIUM_INCOMPLETE()]) {
      const r = resultFor(v);
      expect(r.verdictStatus).toBe("ready_to_ship"); // raw status stays raw metadata
      expect(r.affirmsDeploy).toBe(false);
      const s = summaryOf(r, locale);
      expect(s).not.toMatch(APPROVED_HEADLINE);
      expect(s).not.toContain("READY TO SHIP");
      expect(s).toContain("NO BLOCKERS FOUND — EVIDENCE LIMITED");
      expect(containsApprovalLanguage(s), s).toBe(false);
    }
  });

  it("3-6. NOT_READY / insufficient_data / analysis_failed / no verdict keep their non-approval headlines", () => {
    expect(summaryOf(resultFor(NOT_READY(), { ...ZERO, critical: 1, high: 9 }), locale)).toContain("NOT READY TO SHIP");
    expect(summaryOf(resultFor(INSUFFICIENT()), locale)).toContain("MORE ANALYSIS REQUIRED");
    expect(summaryOf(resultFor(FAILED()), locale)).toContain("ANALYSIS FAILED");
    expect(summaryOf(resultFor(null), locale)).toContain("IN PROGRESS");
    for (const v of [NOT_READY(), INSUFFICIENT(), FAILED(), null]) {
      expect(summaryOf(resultFor(v), locale)).not.toMatch(APPROVED_HEADLINE);
    }
  });

  it("7. headline and recommendation never contradict each other", () => {
    for (const v of [READY(), LIMITED(), MEDIUM_INCOMPLETE(), NOT_READY(), INSUFFICIENT(), FAILED(), null]) {
      const r = resultFor(v);
      const s = summaryOf(r, locale);
      if (APPROVED_HEADLINE.test(s)) {
        expect(r.affirmsDeploy).toBe(true);
        expect(r.recommendation).not.toMatch(/not a deployment approval/i);
      }
      if (/not a deployment approval/i.test(r.recommendation)) {
        expect(s).not.toMatch(APPROVED_HEADLINE);
      }
    }
  });

  it("10. status-only invocation (no canonical flag, or a falsy/absent one) is always conservative", () => {
    for (const flag of [false, undefined, null, 0, "true"]) {
      const r = { ...resultFor(READY()), affirmsDeploy: flag } as unknown as FullProductAuditResult;
      const s = summaryOf(r, locale);
      expect(s, `flag=${String(flag)}`).not.toContain("READY TO SHIP");
      expect(s).toContain("NO BLOCKERS FOUND — EVIDENCE LIMITED");
    }
  });
});

describe("structured fields and source guard", () => {
  it("keeps verdictStatus as raw machine metadata and exposes the canonical flag", () => {
    const response = formatFullProductAuditResponse(resultFor(LIMITED()), getMcpTranslator("en"));
    expect(response.verdictStatus).toBe("ready_to_ship");
    expect(response.affirmsDeploy).toBe(false);
    expect(formatFullProductAuditResponse(resultFor(READY()), getMcpTranslator("en")).affirmsDeploy).toBe(true);
  });

  it("the formatter has no raw verdictHeadline(status) call left outside the gated helper", () => {
    const source = readFileSync("server/full-product-audit/format-response.ts", "utf8");
    const calls = source.match(/verdictHeadline\(/g) ?? [];
    expect(calls).toHaveLength(1); // only inside auditHeadline, after the affirmsDeploy check
    expect(source).toMatch(/result\.verdictStatus === "ready_to_ship" && result\.affirmsDeploy !== true/);
    const helper = source.slice(source.indexOf("function auditHeadline"), source.indexOf("function appendFinalVerdict"));
    expect(helper.indexOf("affirmsDeploy !== true")).toBeGreaterThan(-1);
    expect(helper.indexOf("affirmsDeploy !== true")).toBeLessThan(helper.indexOf("verdictHeadline("));
    expect(source.match(/auditHeadline\(result\)/g) ?? []).toHaveLength(2); // both former raw call sites
  });
});
