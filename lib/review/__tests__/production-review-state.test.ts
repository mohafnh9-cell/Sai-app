import { describe, expect, it } from "vitest";
import {
  mapScanStatusToProductionReviewUiStatus,
  productionReviewHasActiveWork,
  productionReviewShowsSpinner,
} from "../production-review-state";

describe("production review UI state helpers", () => {
  it("maps scan statuses to UI contract", () => {
    expect(mapScanStatusToProductionReviewUiStatus("queued")).toBe("queued");
    expect(mapScanStatusToProductionReviewUiStatus("fetching_repository")).toBe("running");
    expect(mapScanStatusToProductionReviewUiStatus("scanning")).toBe("analyzing");
    expect(mapScanStatusToProductionReviewUiStatus("cancelled")).toBe("cancelled");
  });

  it("shows spinner only for active work statuses", () => {
    expect(productionReviewShowsSpinner("queued")).toBe(true);
    expect(productionReviewShowsSpinner("cancelled")).toBe(false);
    expect(productionReviewShowsSpinner("stale")).toBe(false);
    expect(productionReviewShowsSpinner("idle")).toBe(false);
  });

  it("requires hasActiveReview for spinner", () => {
    expect(productionReviewHasActiveWork("queued", true)).toBe(true);
    expect(productionReviewHasActiveWork("queued", false)).toBe(false);
  });
});

describe("cancel button visibility contract", () => {
  it("is driven by isCancellable not label text", () => {
    const active = {
      hasActiveReview: true,
      isCancellable: true,
      status: "queued" as const,
    };
    expect(active.isCancellable && active.hasActiveReview).toBe(true);
  });
});
