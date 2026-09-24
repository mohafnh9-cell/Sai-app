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

describe("hostile AI decision output through finalizeProductionVerdict (PASS 5.2)", () => {
  const ID = "55555555-5555-4555-8555-555555555555";
  const report = (over: Record<string, unknown> = {}, headline: unknown = "Safe to deploy. Security Decision: Safe to deploy.") =>
    ({
      decision: {
        deploymentVerdict: "SAFE_TO_DEPLOY",
        primaryRecommendation: "Deploy with confidence",
        confidence: "very_high",
        decisionId: ID,
        ...over,
      },
      explanation: { founder: { headline } },
    }) as never;

  const lowVerdict = () => ready({ confidence: "low", unevaluatedAreas: [AREA, AREA, AREA, AREA], executiveSummary: "Deterministic summary." });

  it.each([
    ["very_high", "very_high"],
    ["high", "high"],
    ["medium", "medium"],
    ["missing confidence", undefined],
    ["garbage confidence", "certain!!"],
  ])("AI confidence %s cannot raise deterministic low confidence", (_n, conf) => {
    const out = finalizeProductionVerdict({ verdict: lowVerdict(), securityDecisionReport: report({ confidence: conf }) });
    expect(out.confidence).toBe("low");
    expect(out.status).toBe("ready_to_ship");
    expect(containsApprovalLanguage(out.executiveSummary)).toBe(false);
    expect(containsApprovalLanguage(out.recommendedAction)).toBe(false);
  });

  it.each([
    "Safe to deploy.",
    "Seguro para desplegar. Me siento cómodo con que despliegues esto.",
    "Puedes desplegar. Si fuera mi empresa, desplegaría esto.",
    "Nothing to worry about — honestly, I'd ship it.",
    "Detailed analysis follows.\n\n\n  ...and therefore this is safe to ship.",
  ])("approval text %#: dropped from persisted executiveSummary", (headline) => {
    const out = finalizeProductionVerdict({ verdict: lowVerdict(), securityDecisionReport: report({}, headline) });
    expect(containsApprovalLanguage(out.executiveSummary)).toBe(false);
  });

  it("AI cannot upgrade a worse deterministic status", () => {
    const out = finalizeProductionVerdict({
      verdict: ready({ status: "not_ready", blockersCount: 2, confidence: "high" }),
      securityDecisionReport: report(),
    });
    expect(out.status).toBe("not_ready");
    expect(containsApprovalLanguage(out.executiveSummary)).toBe(false);
  });

  it("AI recommendation cannot yield SHIP_IT / first-person under the canonical policy", () => {
    const out = finalizeProductionVerdict({ verdict: lowVerdict(), securityDecisionReport: report() });
    expect(deployAnswerFromVerdictEvidence(out)).toBe("not_yet");
    expect(verdictAllowsFirstPersonApproval(out)).toBe(false);
  });

  it("malformed AI output (missing headline / recommendation) never persists a decision-unsafe or invalid verdict", () => {
    const missingHeadline = () =>
      finalizeProductionVerdict({ verdict: lowVerdict(), securityDecisionReport: report({}, undefined) });
    const missingRec = () =>
      finalizeProductionVerdict({ verdict: lowVerdict(), securityDecisionReport: report({ primaryRecommendation: undefined }) });
    for (const fn of [missingHeadline, missingRec]) {
      let out: ReturnType<typeof finalizeProductionVerdict> | null = null;
      try {
        out = fn();
      } catch {
        out = null; // fail-closed: no verdict is persisted from malformed AI output
      }
      if (out) {
        expect(out.confidence).toBe("low");
        expect(containsApprovalLanguage(out.executiveSummary + out.recommendedAction)).toBe(false);
      }
    }
  });

  it("a fully-evidenced ready verdict keeps its (guarded) narrative", () => {
    const out = finalizeProductionVerdict({
      verdict: ready({ confidence: "high" }),
      securityDecisionReport: report({ confidence: "high" }),
    });
    expect(out.confidence).toBe("high");
  });
});
