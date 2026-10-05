import { describe, expect, it } from "vitest";
import {
  buildProductionJourney,
  calculateTrend,
  calculateMaturity,
  calculateScoreChange,
  detectMilestones,
  determineCurrentFocus,
  isValidJourneyVerdict,
  toJourneyPreview,
  type VerdictJourneyRecord,
} from "@/brain/production-journey";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { PRODUCTION_VERDICT_VERSION } from "@/brain/production-verdict/schema";

function uuid(n: number): string {
  return `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function baseVerdict(overrides: Partial<ProductionVerdictV1> = {}): ProductionVerdictV1 {
  return {
    version: PRODUCTION_VERDICT_VERSION,
    projectId: uuid(1),
    repositoryId: uuid(1),
    scanId: uuid(2),
    commitSha: "abc123",
    branch: "main",
    status: "needs_improvement",
    score: 60,
    previousScore: 50,
    scoreDelta: 10,
    projectedScore: 75,
    projectedScoreIsEstimate: true,
    blockersCount: 2,
    criticalBlockersCount: 1,
    highBlockersCount: 1,
    estimatedFixMinutes: 30,
    confidence: "high",
    executiveSummary: "Summary",
    topPriorities: [],
    evaluatedAreas: [],
    partiallyEvaluatedAreas: [],
    unevaluatedAreas: [],
    introducedBlockers: 0,
    resolvedBlockers: 1,
    coverageRatio: 0.8,
    filesAnalyzed: 10,
    findingsCount: 2,
    recommendedAction: "Fix auth",
    methodologyNote: "Note",
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

type RecordInput = Partial<Omit<VerdictJourneyRecord, "verdict">> & {
  verdict?: Partial<ProductionVerdictV1>;
};

function record(index: number, overrides: RecordInput = {}): VerdictJourneyRecord {
  const generatedAt = new Date(Date.UTC(2026, 0, index + 1)).toISOString();
  const verdictOverrides = overrides.verdict ?? {};
  const verdict = baseVerdict({
    scanId: uuid(100 + index),
    generatedAt,
    ...verdictOverrides,
  });
  const { verdict: _v, ...rest } = overrides;
  return {
    id: uuid(1000 + index),
    scanId: verdict.scanId,
    projectId: verdict.projectId,
    repositoryId: verdict.repositoryId,
    generatedAt,
    commitSha: verdict.commitSha,
    branch: verdict.branch,
    status: verdict.status,
    score: verdict.score,
    previousScore: verdict.previousScore,
    scoreDelta: verdict.scoreDelta,
    blockersCount: verdict.blockersCount,
    introducedBlockers: verdict.introducedBlockers,
    resolvedBlockers: verdict.resolvedBlockers,
    verdict,
    ...rest,
  };
}

describe("Block 6.5 Production Journey", () => {
  it("marks null scores as not valid for chart", () => {
    expect(isValidJourneyVerdict("insufficient_data", null)).toBe(false);
    expect(isValidJourneyVerdict("analysis_failed", 40)).toBe(false);
    expect(isValidJourneyVerdict("almost_ready", 72)).toBe(true);
  });

  it("returns insufficient_data trend with one valid verdict", () => {
    const journey = buildProductionJourney([record(0, { verdict: { score: 55 } })]);
    expect(journey.trend).toBe("insufficient_data");
    expect(journey.validReviews).toBe(1);
  });

  it("detects improving trend", () => {
    const records = [
      record(0, { verdict: { score: 35, scoreDelta: null, status: "not_ready" } }),
      record(1, { verdict: { score: 45, scoreDelta: 10, status: "not_ready" } }),
      record(2, { verdict: { score: 58, scoreDelta: 13, status: "needs_improvement" } }),
      record(3, { verdict: { score: 72, scoreDelta: 14, status: "almost_ready" } }),
    ];
    expect(calculateTrend(buildProductionJourney(records).timeline)).toBe("improving");
  });

  it("detects declining trend", () => {
    const records = [
      record(0, { verdict: { score: 80, status: "almost_ready" } }),
      record(1, { verdict: { score: 65, scoreDelta: -15, status: "needs_improvement" } }),
      record(2, { verdict: { score: 50, scoreDelta: -15, status: "needs_improvement", introducedBlockers: 3 } }),
    ];
    expect(calculateTrend(buildProductionJourney(records).timeline)).toBe("declining");
  });

  it("detects stable trend", () => {
    const records = [
      record(0, { verdict: { score: 62, status: "needs_improvement" } }),
      record(1, { verdict: { score: 64, scoreDelta: 2, status: "needs_improvement" } }),
      record(2, { verdict: { score: 63, scoreDelta: -1, status: "needs_improvement" } }),
    ];
    expect(calculateTrend(buildProductionJourney(records).timeline)).toBe("stable");
  });

  it("calculates score changes over 7 and 30 days", () => {
    const day = (offset: number) =>
      new Date(Date.UTC(2026, 0, 1 + offset)).toISOString();
    const records = [
      record(0, {
        generatedAt: day(0),
        verdict: { score: 40, scoreDelta: null, status: "not_ready", generatedAt: day(0) },
      }),
      record(1, {
        generatedAt: day(10),
        verdict: { score: 55, scoreDelta: 15, status: "needs_improvement", generatedAt: day(10) },
      }),
      record(2, {
        generatedAt: day(35),
        verdict: { score: 70, scoreDelta: 15, status: "almost_ready", generatedAt: day(35) },
      }),
    ];
    const timeline = buildProductionJourney(records).timeline;
    expect(calculateScoreChange(timeline, 7)).toBe(15);
    expect(calculateScoreChange(timeline, 30)).toBe(30);
  });

  it("tracks best score and blockers", () => {
    const journey = buildProductionJourney([
      record(0, { verdict: { score: 40, resolvedBlockers: 1, introducedBlockers: 0 } }),
      record(1, { verdict: { score: 72, resolvedBlockers: 2, introducedBlockers: 1 } }),
    ]);
    expect(journey.bestScore).toBe(72);
    expect(journey.blockersResolved).toBe(3);
    expect(journey.blockersIntroduced).toBe(1);
  });

  it("detects first verdict milestone", () => {
    const milestones = detectMilestones(buildProductionJourney([record(0)]).timeline);
    expect(milestones.some((m) => m.type === "first_verdict")).toBe(true);
  });

  it("calculates maturity for ready_to_ship", () => {
    const journey = buildProductionJourney([
      record(0, { verdict: { score: 75, status: "almost_ready", blockersCount: 1 } }),
      record(1, { verdict: { score: 88, status: "ready_to_ship", blockersCount: 0 } }),
    ]);
    expect(calculateMaturity({
      validReviews: journey.validReviews,
      currentStatus: journey.currentStatus,
      // Only the canonical posture ("ready": high confidence, complete coverage) may reach production_ready.
      currentPosture: journey.currentDeploymentPosture,
      currentScore: journey.currentScore,
      trend: journey.trend,
      blockersResolved: journey.blockersResolved,
      timeline: journey.timeline,
    })).toBe("production_ready");
  });

  it("determines current focus from top priority", () => {
    const verdict = baseVerdict({
      topPriorities: [
        {
          id: "p1",
          rank: 1,
          title: "Fix auth",
          category: "Authentication",
          reason: "r",
          severity: "critical",
          confidence: "high",
          estimatedMinutes: 10,
          estimatedTimeLabel: "10m",
          projectedScoreImpact: 5,
          affectedFiles: [],
          recommendedAction: "a",
          findingIds: [],
        },
      ],
    });
    const focus = determineCurrentFocus(verdict);
    expect(focus.focusKey).toBe("focus.authentication");
  });

  it("skips failed scans without treating null as zero in timeline", () => {
    const journey = buildProductionJourney([
      record(0, { verdict: { score: null, status: "analysis_failed" } }),
      record(1, { verdict: { score: 60, status: "needs_improvement" } }),
    ]);
    expect(journey.validReviews).toBe(1);
    expect(journey.timeline[0].isValidForScoreChart).toBe(false);
  });

  it("builds preview with same score values as full journey", () => {
    const journey = buildProductionJourney([
      record(0, { verdict: { score: 50, status: "needs_improvement" } }),
      record(1, { verdict: { score: 68, scoreDelta: 18, status: "almost_ready" } }),
    ]);
    const preview = toJourneyPreview(journey);
    expect(preview.currentScore).toBe(journey.currentScore);
    expect(preview.bestScore).toBe(journey.bestScore);
    expect(preview.trend).toBe(journey.trend);
    expect(preview.latestScoreDelta).toBe(18);
  });

  it("detects ready_to_ship and regression recovery milestones", () => {
    const milestones = detectMilestones(
      buildProductionJourney([
        record(0, { verdict: { score: 88, status: "ready_to_ship" } }),
        record(1, { verdict: { score: 70, scoreDelta: -18, status: "needs_improvement" } }),
        record(2, { verdict: { score: 90, scoreDelta: 20, status: "ready_to_ship" } }),
      ]).timeline
    );
    expect(milestones.some((m) => m.type === "ready_to_ship")).toBe(true);
    expect(milestones.some((m) => m.type === "recovered_after_regression")).toBe(true);
  });

  it("calculates production_maintained after consecutive ready_to_ship reviews", () => {
    const journey = buildProductionJourney([
      record(0, { verdict: { score: 85, status: "ready_to_ship", blockersCount: 0 } }),
      record(1, { verdict: { score: 88, status: "ready_to_ship", blockersCount: 0 } }),
    ]);
    expect(journey.maturity).toBe("production_maintained");
  });
});
