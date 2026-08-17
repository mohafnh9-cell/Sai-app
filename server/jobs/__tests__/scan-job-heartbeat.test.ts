import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

const touchScanJobHeartbeat = vi.fn().mockResolvedValue(undefined);

vi.mock("@/server/jobs/scan-job-store", () => ({
  touchScanJobHeartbeat,
}));

describe("startScanJobHeartbeat", () => {
  beforeEach(() => {
    touchScanJobHeartbeat.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes periodic heartbeats and cleans up on stop", async () => {
    const { startScanJobHeartbeat, getScanJobHeartbeatIntervalMs } = await import(
      "../scan-job-heartbeat"
    );
    const intervalMs = getScanJobHeartbeatIntervalMs();
    const stop = startScanJobHeartbeat({} as never, "job-1");

    vi.advanceTimersByTime(intervalMs + 1);
    expect(touchScanJobHeartbeat).toHaveBeenCalledTimes(1);

    stop();
    vi.advanceTimersByTime(intervalMs * 3);
    expect(touchScanJobHeartbeat).toHaveBeenCalledTimes(1);
  });

  it("does not throw when heartbeat writes fail", async () => {
    touchScanJobHeartbeat.mockRejectedValueOnce(new Error("db unavailable"));
    const { startScanJobHeartbeat, getScanJobHeartbeatIntervalMs } = await import(
      "../scan-job-heartbeat"
    );
    const stop = startScanJobHeartbeat({} as never, "job-1");
    vi.advanceTimersByTime(getScanJobHeartbeatIntervalMs() + 1);
    stop();
    expect(touchScanJobHeartbeat).toHaveBeenCalled();
  });
});

describe("scan job heartbeat stale detection", () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it("defaults stale window to two heartbeat intervals plus buffer", async () => {
    delete process.env.SCAN_JOB_HEARTBEAT_INTERVAL_MS;
    const { getScanJobHeartbeatIntervalMs, getScanJobHeartbeatStaleMs } = await import(
      "../scan-job-heartbeat"
    );
    expect(getScanJobHeartbeatIntervalMs()).toBe(60_000);
    expect(getScanJobHeartbeatStaleMs()).toBe(150_000);
  });
});
