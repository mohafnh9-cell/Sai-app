import { describe, expect, it } from "vitest";
import {
  deriveHasCompletedAnalysis,
  deriveLastAnalysisAt,
  deriveScanAction,
} from "@/server/mission-control/derive-mission-control-ui";
import type { AnalysisRunListItem } from "@/server/analysis-runs/list-analysis-runs";

const idleReviewState = {
  hasActiveReview: false,
  scanId: null,
  scanJobId: null,
  status: "idle" as const,
  isCancellable: false,
  commitSha: null,
  createdAt: null,
  startedAt: null,
  completedAt: null,
  cancelledAt: null,
  failureMessage: null,
};

function run(overrides: Partial<AnalysisRunListItem>): AnalysisRunListItem {
  return {
    runId: "run-1",
    status: "completed",
    commitSha: "abc1234",
    branch: "main",
    createdAt: "2026-01-01T12:00:00.000Z",
    completedAt: null,
    securityScore: null,
    verdictStatus: null,
    ...overrides,
  };
}

describe("deriveLastAnalysisAt", () => {
  it("uses createdAt when completed_at is missing but status is completed", () => {
    const activeRun = run({ completedAt: null, createdAt: "2026-01-01T12:00:00.000Z" });
    expect(
      deriveLastAnalysisAt({
        productionVerdict: null,
        activeRun,
        latestRun: activeRun,
        productionReviewState: idleReviewState,
      })
    ).toBe("2026-01-01T12:00:00.000Z");
  });

  it("returns null when no completed run exists", () => {
    expect(
      deriveLastAnalysisAt({
        productionVerdict: null,
        activeRun: null,
        latestRun: null,
        productionReviewState: idleReviewState,
      })
    ).toBeNull();
  });
});

describe("deriveHasCompletedAnalysis + deriveLastAnalysisAt consistency", () => {
  it("does not treat completed runs without a verdict as analyzed", () => {
    const activeRun = run({ completedAt: null });
    const hasCompleted = deriveHasCompletedAnalysis({
      productionVerdict: null,
      activeRun,
      latestRun: activeRun,
      productionReviewState: idleReviewState,
    });
    expect(hasCompleted).toBe(false);
  });

  it("treats verdict presence as analyzed even when run timestamps are missing", () => {
    const hasCompleted = deriveHasCompletedAnalysis({
      productionVerdict: {
        version: "1.0.0",
        status: "needs_improvement",
        score: 70,
        generatedAt: "2026-01-01T12:00:00.000Z",
      } as import("@/brain/production-verdict/schema").ProductionVerdictV1,
      activeRun: null,
      latestRun: null,
      productionReviewState: idleReviewState,
    });
    expect(hasCompleted).toBe(true);
  });
});

describe("deriveScanAction", () => {
  it("returns rescan when analysis completed", () => {
    const action = deriveScanAction({
      reviewInProgress: false,
      hasCompletedAnalysis: true,
      productionReviewState: { ...idleReviewState, status: "idle" },
      githubNeedsReconnect: false,
    });
    expect(action.label).toBe("rescan");
    expect(action.disabled).toBe(false);
  });
});
