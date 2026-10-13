import { describe, expect, it } from "vitest";
import { assessScanJobAbandonment, isScanJobAbandoned, scanJobLastActivityMs } from "../orphan-policy";
import { getScanJobHeartbeatStaleMs } from "../scan-job-heartbeat";

const NOW = Date.parse("2026-10-10T07:13:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const STALE = getScanJobHeartbeatStaleMs();

describe("when is a scan job abandoned (and therefore recoverable)", () => {
  it("never on the strength of 'scan completed' alone: a job with a recent signal is alive", () => {
    for (const field of ["heartbeat_at", "started_at", "updated_at"] as const) {
      expect(isScanJobAbandoned({ status: "running", [field]: ago(5_000) }, NOW)).toBe(false);
    }
    expect(isScanJobAbandoned({ status: "running", metadata: { lastTraceAt: ago(5_000) } }, NOW)).toBe(false);
  });

  it("the newest of all signals decides", () => {
    const job = { status: "running", heartbeat_at: ago(STALE * 4), started_at: ago(STALE * 5), updated_at: ago(STALE * 3), metadata: { lastTraceAt: ago(1_000) } };
    expect(scanJobLastActivityMs(job)).toBe(NOW - 1_000);
    expect(isScanJobAbandoned(job, NOW)).toBe(false);
  });

  it("abandoned only after the heartbeat stale window", () => {
    expect(isScanJobAbandoned({ status: "running", heartbeat_at: ago(STALE - 1_000) }, NOW)).toBe(false);
    expect(assessScanJobAbandonment({ status: "running", heartbeat_at: ago(STALE + 1_000) }, NOW)).toMatchObject({ abandoned: true, reason: "stale" });
  });

  it("an exceeded execution deadline abandons even a recently-touched job", () => {
    expect(assessScanJobAbandonment({ status: "running", heartbeat_at: ago(1_000), execution_deadline_at: ago(1_000) }, NOW)).toMatchObject({ abandoned: true, reason: "deadline_exceeded" });
  });

  it("a job that cannot prove it is alive (no signal at all) is abandoned", () => {
    expect(assessScanJobAbandonment({ status: "running" }, NOW)).toMatchObject({ abandoned: true, reason: "no_activity_signal", lastActivityAt: null });
    expect(assessScanJobAbandonment({ status: "running", heartbeat_at: "not-a-date" }, NOW)).toMatchObject({ abandoned: true, reason: "no_activity_signal" });
  });

  it("a queued job counts its schedule time as activity", () => {
    expect(isScanJobAbandoned({ status: "queued", scheduled_at: ago(10_000) }, NOW)).toBe(false);
    expect(isScanJobAbandoned({ status: "queued", scheduled_at: ago(STALE + 5_000) }, NOW)).toBe(true);
  });
});
