import { describe, expect, it } from "vitest";
import { safeParseProductionVerdict } from "@/brain/production-verdict/schema";
import { finalizeProductionVerdict } from "@/brain/production-verdict/finalize-verdict";
import { containsApprovalLanguage } from "@/brain/production-verdict/narrative-guard";
import { evaluateProtectionStatus } from "@/server/continuous-protection/status-machine";
import { buildFounderSummary } from "@/server/protection-reports/founder-summary";
import type { ProtectionReportData } from "@/server/protection-reports/types";
import { deployAnswerFromVerdictEvidence, verdictAllowsFirstPersonApproval } from "@/server/production-memory/types";
import { productionReadyFromVerdict } from "@/server/brain/verdict-view-model";
import { buildVerdictFixture } from "./verdict-fixture";

function parse(raw: unknown) {
  const v = safeParseProductionVerdict(raw);
  if (!v) throw new Error("verdict did not parse");
  return v;
}

const AREA = { key: "testing", label: "t", status: "not_evaluated", score: null, confidence: "low", evidenceCount: 0, methodology: "m" } as never;

const HOSTILE = "Safe to deploy based on current authorized security evidence. I would ship this.";

function ready(over: Record<string, unknown> = {}) {
  return buildVerdictFixture({
    status: "ready_to_ship",
    blockersCount: 0,
    criticalBlockersCount: 0,
    highBlockersCount: 0,
    topPriorities: [],
    executiveSummary: HOSTILE,
    recommendedAction: "Deploy with confidence",
    ...over,
  } as never);
}

describe("stored / AI narrative cannot strengthen a decision (schema choke point)", () => {
  it.each([
    ["low confidence", { confidence: "low" }],
    ["medium confidence", { confidence: "medium" }],
    ["unevaluated areas", { confidence: "high", unevaluatedAreas: [AREA] }],
    ["not_ready", { status: "not_ready", confidence: "high" }],
  ])("read path drops approval text: %s", (_n, over) => {
    const parsed = parse(ready(over));
    expect(containsApprovalLanguage(parsed.executiveSummary)).toBe(false);
    expect(containsApprovalLanguage(parsed.recommendedAction)).toBe(false);
  });

  it("keeps approval wording only for high confidence + all areas evaluated", () => {
    const parsed = parse(ready({ confidence: "high" }));
    expect(parsed.executiveSummary).toBe(HOSTILE);
  });

  it("unknown/garbage confidence is treated as low, not medium", () => {
    const raw = { ...ready(), confidence: "very_high_plus" };
    expect(parse(raw).confidence).toBe("low");
  });

  it("write path: AI decision can neither raise confidence nor inject approval text", () => {
    const out = finalizeProductionVerdict({
      verdict: ready({ confidence: "low" }),
      securityDecisionReport: {
        decision: {
          deploymentVerdict: "SAFE_TO_DEPLOY",
          primaryRecommendation: "Deploy with confidence",
          confidence: "very_high",
          decisionId: "55555555-5555-4555-8555-555555555555",
        },
        explanation: { founder: { headline: "Safe to deploy based on current authorized security evidence." } },
      },
    });
    expect(out.confidence).toBe("low");
    expect(containsApprovalLanguage(out.executiveSummary)).toBe(false);
    expect(containsApprovalLanguage(out.recommendedAction)).toBe(false);
  });
});

describe("founder summary cannot bypass the policy", () => {
  const data = (endLabel: string): ProtectionReportData =>
    ({
      protectionStatus: { start: null, end: null, endLabel },
      productionConfidence: { start: 90, end: 92, delta: 2 },
      securityConfidence: { start: 90, end: 92, delta: 2 },
      whatImproved: [],
      whatBecameWorse: [],
      openRecommendations: [],
      topPriorities: [],
      statistics: { dailyChecksCompleted: 3 },
    }) as never;

  const machineInput = (v: ReturnType<typeof ready>) => ({
    continuousProtectionEnabled: true,
    continuousProtectionPaused: false,
    githubConnected: true,
    hasSuccessfulReview: true,
    lastCheckAt: new Date().toISOString(),
    consecutiveDailyFailures: 0,
    deployAnswer: deployAnswerFromVerdictEvidence(v),
    approvalEligible: verdictAllowsFirstPersonApproval(v),
    openCriticalCount: 0,
    openHighCount: 0,
    productionConfidence: 100,
    securityConfidence: 100,
    productionConfidenceDelta7d: 0,
    securityConfidenceDelta7d: 0,
    materialChangeIn7d: false,
    attackSurfaceIncreased: false,
    newCriticalDependencyAdvisory: false,
    staleCheckWhileCpOn: false,
  });

  it.each([
    ["low confidence", { confidence: "low" }],
    ["medium confidence", { confidence: "medium" }],
    ["unevaluated areas", { confidence: "high", unevaluatedAreas: [AREA] }],
  ])("evidence path (%s) never yields 'I would deploy'", (_n, over) => {
    const v = parse(ready(over));
    const label = evaluateProtectionStatus(machineInput(v));
    expect(label).not.toBe("PROTECTED");
    const summary = buildFounderSummary("weekly", data(label), "App");
    expect(summary.wouldDeployToday).not.toMatch(/I would deploy/);
  });

  it("only a high-confidence, fully-evaluated verdict can reach PROTECTED / first-person", () => {
    const v = parse(ready({ confidence: "high" }));
    expect(evaluateProtectionStatus(machineInput(v))).toBe("PROTECTED");
  });

  it("web readyForProduction follows the same policy", () => {
    expect(productionReadyFromVerdict(parse(ready({ confidence: "low" }))).readyForProduction).toBe(false);
    expect(productionReadyFromVerdict(parse(ready({ confidence: "high" }))).readyForProduction).toBe(true);
  });
});
