import { describe, expect, it } from "vitest";
import {
  isAnalysisRunImmutable,
  isTerminalScanStatus,
} from "../is-analysis-run-immutable";

describe("isTerminalScanStatus", () => {
  it("recognizes terminal statuses", () => {
    expect(isTerminalScanStatus("completed")).toBe(true);
    expect(isTerminalScanStatus("failed")).toBe(true);
    expect(isTerminalScanStatus("cancelled")).toBe(true);
  });

  it("rejects active statuses", () => {
    expect(isTerminalScanStatus("queued")).toBe(false);
    expect(isTerminalScanStatus("scanning")).toBe(false);
  });
});

describe("isAnalysisRunImmutable", () => {
  it("returns true when immutability_locked_at is set", () => {
    expect(
      isAnalysisRunImmutable({
        status: "scanning",
        immutabilityLockedAt: "2026-01-01T00:00:00Z",
      })
    ).toBe(true);
  });

  it("returns true for terminal status without lock timestamp", () => {
    expect(isAnalysisRunImmutable({ status: "completed" })).toBe(true);
  });

  it("returns false for active status without lock", () => {
    expect(isAnalysisRunImmutable({ status: "queued" })).toBe(false);
  });
});
