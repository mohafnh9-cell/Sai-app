import { describe, expect, it, afterEach } from "vitest";
import {
  getScanOrgFallbackMode,
  parseConfiguredScanSchedulerMode,
  resolveScanSchedulerPlan,
} from "@/lib/env/scan-scheduler-plan";

describe("scan scheduler plan", () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it("defaults configured mode to inline when unset", () => {
    delete process.env.SCAN_SCHEDULER;
    expect(parseConfiguredScanSchedulerMode()).toEqual({ mode: "inline", invalidRaw: null });
    const plan = resolveScanSchedulerPlan("org-1");
    expect(plan.ok && plan.executor).toBe("inline");
  });

  it("fails inngest plan when event key missing", () => {
    process.env.SCAN_SCHEDULER = "inngest";
    delete process.env.INNGEST_EVENT_KEY;
    const plan = resolveScanSchedulerPlan("org-1");
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.code).toBe("INGEST_NOT_CONFIGURED");
  });

  it("rejects org outside allowlist when fallback is error", () => {
    process.env.SCAN_SCHEDULER = "inngest";
    process.env.INNGEST_EVENT_KEY = "test-key";
    process.env.INNGEST_ASYNC_ORG_ALLOWLIST = "allowed-org";
    delete process.env.SCAN_SCHEDULER_ORG_FALLBACK;
    const plan = resolveScanSchedulerPlan("blocked-org");
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.code).toBe("ORG_NOT_IN_INGEST_ALLOWLIST");
  });

  it("uses inline executor for excluded org when fallback=inline", () => {
    process.env.SCAN_SCHEDULER = "inngest";
    process.env.INNGEST_EVENT_KEY = "test-key";
    process.env.INNGEST_ASYNC_ORG_ALLOWLIST = "allowed-org";
    process.env.SCAN_SCHEDULER_ORG_FALLBACK = "inline";
    expect(getScanOrgFallbackMode()).toBe("inline");
    const plan = resolveScanSchedulerPlan("blocked-org");
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.executor).toBe("inline");
      expect(plan.orgFallbackUsed).toBe(true);
    }
  });

  it("allows inngest executor for org on allowlist", () => {
    process.env.SCAN_SCHEDULER = "inngest";
    process.env.INNGEST_EVENT_KEY = "test-key";
    process.env.INNGEST_ASYNC_ORG_ALLOWLIST = "org-a,org-b";
    const plan = resolveScanSchedulerPlan("org-b");
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.executor).toBe("inngest");
  });
});
