import { describe, expect, it } from "vitest";
import { isProductionReviewCancellable } from "../production-review-cancellable";

describe("isProductionReviewCancellable", () => {
  it("allows queued scan with queued job", () => {
    expect(isProductionReviewCancellable({ scanStatus: "queued", scanJobStatus: "queued" })).toBe(
      true
    );
  });

  it("allows active job when scan status lags", () => {
    expect(isProductionReviewCancellable({ scanStatus: "queued", scanJobStatus: "running" })).toBe(
      true
    );
  });

  it("rejects completed scan", () => {
    expect(isProductionReviewCancellable({ scanStatus: "completed", scanJobStatus: "running" })).toBe(
      false
    );
  });

  it("rejects cancelled scan", () => {
    expect(isProductionReviewCancellable({ scanStatus: "cancelled" })).toBe(false);
  });
});
