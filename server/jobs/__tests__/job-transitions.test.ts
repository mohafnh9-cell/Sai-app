import { describe, expect, it } from "vitest";
import {
  assertScanJobTransition,
  canRecoverScanJobToQueued,
  canTransitionScanJob,
  isTerminalScanJobStatus,
} from "../job-transitions";

describe("scan job transitions", () => {
  it("allows queued → running → completed", () => {
    expect(canTransitionScanJob("queued", "running")).toBe(true);
    expect(canTransitionScanJob("running", "completed")).toBe(true);
  });

  it("allows queued → running → failed", () => {
    expect(canTransitionScanJob("queued", "running")).toBe(true);
    expect(canTransitionScanJob("running", "failed")).toBe(true);
  });

  it("allows queued → cancelled and running → cancelled", () => {
    expect(canTransitionScanJob("queued", "cancelled")).toBe(true);
    expect(canTransitionScanJob("running", "cancelled")).toBe(true);
  });

  it("rejects invalid transitions", () => {
    expect(canTransitionScanJob("completed", "running")).toBe(false);
    expect(canTransitionScanJob("failed", "completed")).toBe(false);
    expect(canTransitionScanJob("cancelled", "running")).toBe(false);
    expect(canTransitionScanJob("queued", "completed")).toBe(false);
    expect(canTransitionScanJob("queued", "queued")).toBe(false);
  });

  it("allows explicit recovery sources only", () => {
    expect(canRecoverScanJobToQueued("queued")).toBe(true);
    expect(canRecoverScanJobToQueued("running")).toBe(true);
    expect(canRecoverScanJobToQueued("completed")).toBe(false);
  });

  it("throws on invalid transitions", () => {
    expect(() => assertScanJobTransition("completed", "running")).toThrow(
      "Invalid scan job transition"
    );
  });

  it("marks terminal states correctly", () => {
    expect(isTerminalScanJobStatus("completed")).toBe(true);
    expect(isTerminalScanJobStatus("failed")).toBe(true);
    expect(isTerminalScanJobStatus("cancelled")).toBe(true);
    expect(isTerminalScanJobStatus("running")).toBe(false);
  });
});
