import { describe, expect, it } from "vitest";
import {
  evaluateDeployDecision,
  type HistoricalVerdictSnapshot,
  type LatestReviewSnapshot,
} from "../evaluate-deploy-decision";
import { REVIEW_STALE_FAILURE_CODE } from "@/server/review-recovery/stale-review";

const historical: HistoricalVerdictSnapshot = {
  scanId: "old-scan",
  commitSha: "old-commit-full",
  status: "needs_improvement",
  score: 65,
};

function latest(overrides: Partial<LatestReviewSnapshot>): LatestReviewSnapshot {
  return {
    id: "new-scan",
    status: "queued",
    commitSha: "new-commit-full",
    errorCode: null,
    ...overrides,
  };
}

describe("evaluateDeployDecision", () => {
  it("answers from the completed verdict when the newest review is completed and matches", () => {
    const result = evaluateDeployDecision({
      latestReview: latest({ status: "completed", id: "old-scan", commitSha: "old-commit-full" }),
      historicalVerdict: historical,
    });
    expect(result).toEqual({ kind: "answerable" });
  });

  it("defers when the newest review is queued", () => {
    const result = evaluateDeployDecision({
      latestReview: latest({ status: "queued" }),
      historicalVerdict: historical,
    });
    expect(result).toMatchObject({ kind: "deferred", reason: "in_progress" });
  });

  it("defers when the newest review is processing", () => {
    const result = evaluateDeployDecision({
      latestReview: latest({ status: "scanning" }),
      historicalVerdict: historical,
    });
    expect(result).toMatchObject({ kind: "deferred", reason: "in_progress" });
  });

  it("defers when the newest review failed", () => {
    const result = evaluateDeployDecision({
      latestReview: latest({ status: "failed", errorCode: "SCAN_FAILED" }),
      historicalVerdict: historical,
    });
    expect(result).toMatchObject({ kind: "deferred", reason: "failed" });
  });

  it("defers with timed_out when the newest review failed due to stale timeout", () => {
    const result = evaluateDeployDecision({
      latestReview: latest({
        status: "failed",
        errorCode: REVIEW_STALE_FAILURE_CODE,
      }),
      historicalVerdict: historical,
    });
    expect(result).toMatchObject({ kind: "deferred", reason: "timed_out" });
  });

  it("defers when the newest review was cancelled", () => {
    const result = evaluateDeployDecision({
      latestReview: latest({ status: "cancelled" }),
      historicalVerdict: historical,
    });
    expect(result).toMatchObject({ kind: "deferred", reason: "cancelled" });
  });

  it("defers when a newer queued review follows an older completed verdict (retry)", () => {
    const result = evaluateDeployDecision({
      latestReview: latest({ status: "queued", commitSha: "retry-commit" }),
      historicalVerdict: historical,
    });
    expect(result).toMatchObject({
      kind: "deferred",
      reason: "in_progress",
      latestReview: expect.objectContaining({ commitSha: "retry-commit" }),
    });
  });

  it("defers when the newest review completed but the verdict has not caught up yet", () => {
    const result = evaluateDeployDecision({
      latestReview: latest({ status: "completed", id: "new-scan", commitSha: "brand-new" }),
      historicalVerdict: historical,
    });
    expect(result).toMatchObject({ kind: "deferred", reason: "awaiting_verdict" });
  });

  it("answers when there is no newer review row", () => {
    const result = evaluateDeployDecision({
      latestReview: null,
      historicalVerdict: historical,
    });
    expect(result).toEqual({ kind: "answerable" });
  });
});
