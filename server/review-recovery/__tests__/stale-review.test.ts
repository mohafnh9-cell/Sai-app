import { describe, expect, it } from "vitest";
import { isActiveReviewScanStatus } from "@/brain/automatic-review/review-status";
import {
  isStaleActiveReviewScan,
  REVIEW_STALE_FAILURE_CODE,
} from "../stale-review";

describe("stale-review detection", () => {
  it("treats only queued/processing statuses as active", () => {
    expect(isActiveReviewScanStatus("queued")).toBe(true);
    expect(isActiveReviewScanStatus("scanning")).toBe(true);
    expect(isActiveReviewScanStatus("completed")).toBe(false);
    expect(isActiveReviewScanStatus("failed")).toBe(false);
    expect(isActiveReviewScanStatus("cancelled")).toBe(false);
  });

  it("flags queued reviews older than the queue stale window", () => {
    const createdAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    expect(
      isStaleActiveReviewScan({
        status: "queued",
        created_at: createdAt,
        updated_at: createdAt,
      })
    ).toBe(true);
  });

  it("flags processing reviews older than the processing stale window", () => {
    const startedAt = new Date(Date.now() - 21 * 60 * 1000).toISOString();
    expect(
      isStaleActiveReviewScan({
        status: "scanning",
        created_at: startedAt,
        updated_at: startedAt,
        started_at: startedAt,
      })
    ).toBe(true);
  });

  it("does not flag fresh active reviews", () => {
    const now = new Date().toISOString();
    expect(
      isStaleActiveReviewScan({
        status: "queued",
        created_at: now,
        updated_at: now,
      })
    ).toBe(false);
  });

  it("uses a stable stale failure code", () => {
    expect(REVIEW_STALE_FAILURE_CODE).toBe("REVIEW_STALE_TIMED_OUT");
  });
});
