import { describe, expect, it } from "vitest";
import {
  deriveScanCodeButtonState,
  scanCodeButtonDisabled,
  scanCodeButtonLabelKey,
} from "@/lib/review/scan-code-button-state";

describe("deriveScanCodeButtonState", () => {
  it("returns idle when no verdict and review is idle", () => {
    expect(
      deriveScanCodeButtonState({
        uiStatus: "idle",
        requesting: false,
        reviewInProgress: false,
        hasCompletedAnalysis: false,
      })
    ).toBe("idle");
  });

  it("returns running while review is active", () => {
    expect(
      deriveScanCodeButtonState({
        uiStatus: "analyzing",
        requesting: false,
        reviewInProgress: true,
        hasCompletedAnalysis: false,
      })
    ).toBe("running");
  });

  it("returns completed after review finishes", () => {
    expect(
      deriveScanCodeButtonState({
        uiStatus: "completed",
        requesting: false,
        reviewInProgress: false,
        hasCompletedAnalysis: true,
      })
    ).toBe("completed");
  });

  it("returns completed when a completed analysis exists even if status is idle", () => {
    expect(
      deriveScanCodeButtonState({
        uiStatus: "idle",
        requesting: false,
        reviewInProgress: false,
        hasCompletedAnalysis: true,
      })
    ).toBe("completed");
  });

  it("returns failed for failed reviews", () => {
    expect(
      deriveScanCodeButtonState({
        uiStatus: "failed",
        requesting: false,
        reviewInProgress: false,
        hasCompletedAnalysis: false,
      })
    ).toBe("failed");
  });
});

describe("scanCodeButtonDisabled", () => {
  it("only disables while running", () => {
    expect(scanCodeButtonDisabled("running")).toBe(true);
    expect(scanCodeButtonDisabled("idle")).toBe(false);
    expect(scanCodeButtonDisabled("completed")).toBe(false);
    expect(scanCodeButtonDisabled("failed")).toBe(false);
  });
});

describe("scanCodeButtonLabelKey", () => {
  it("maps each state to missionControl copy keys", () => {
    expect(scanCodeButtonLabelKey("idle")).toBe("projectHome.scanCode.cta");
    expect(scanCodeButtonLabelKey("running")).toBe("projectHome.scanCode.running");
    expect(scanCodeButtonLabelKey("completed")).toBe("projectHome.scanCode.rescan");
    expect(scanCodeButtonLabelKey("failed")).toBe("projectHome.scanCode.retry");
  });
});
