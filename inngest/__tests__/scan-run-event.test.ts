import { describe, expect, it } from "vitest";
import { INNGEST_EVENTS } from "@/inngest/events";
import { scanRunFunction } from "@/inngest/functions/scan-run";
import { scanJobRecoveryFunction } from "@/inngest/functions/scan-job-recovery";
import {
  buildInngestScanRunPayload,
  parseScanRunInngestEvent,
} from "@/server/jobs/inngest-payload";

describe("Inngest scan/run contract", () => {
  const samplePayload = {
    scanJobId: "11111111-1111-4111-8111-111111111111",
    scanId: "22222222-2222-4222-8222-222222222222",
    organizationId: "33333333-3333-4333-8333-333333333333",
    projectId: "44444444-4444-4444-8444-444444444444",
    userId: "55555555-5555-4555-8555-555555555555",
    headCommitSha: "abcdef1234567890abcdef1234567890abcd",
    branch: "main",
    correlationId: "66666666-6666-4666-8666-666666666666",
    jobType: "manual_scan" as const,
  };

  it("uses the same event name for emitter and worker", () => {
    expect(INNGEST_EVENTS.SCAN_RUN).toBe("scan/run");
    expect(scanRunFunction.opts.triggers[0].event).toBe(INNGEST_EVENTS.SCAN_RUN);
  });

  it("validates and builds dispatch payload with headCommitSha", () => {
    const built = buildInngestScanRunPayload(samplePayload);
    const parsed = parseScanRunInngestEvent(built);
    expect(parsed.scanJobId).toBe(samplePayload.scanJobId);
    expect(parsed.headCommitSha).toBe(samplePayload.headCommitSha);
  });

  it("registers scan job recovery cron function", () => {
    const id =
      typeof scanJobRecoveryFunction.id === "function"
        ? scanJobRecoveryFunction.id()
        : scanJobRecoveryFunction.id;
    expect(id).toBe("scan-job-recovery");
    expect(scanJobRecoveryFunction.opts.triggers[0].cron).toBe("*/5 * * * *");
  });
});
