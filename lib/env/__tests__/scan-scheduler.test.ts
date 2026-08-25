import { describe, expect, it, afterEach } from "vitest";
import {
  getScanSchedulerMode,
  isInngestEnabledForOrganization,
  isInngestSchedulerEnabled,
} from "@/lib/env/scan-scheduler";

describe("scan scheduler org allowlist", () => {
  const originalScheduler = process.env.SCAN_SCHEDULER;
  const originalAllowlist = process.env.INNGEST_ASYNC_ORG_ALLOWLIST;
  const originalEventKey = process.env.INNGEST_EVENT_KEY;

  afterEach(() => {
    if (originalScheduler === undefined) delete process.env.SCAN_SCHEDULER;
    else process.env.SCAN_SCHEDULER = originalScheduler;
    if (originalAllowlist === undefined) delete process.env.INNGEST_ASYNC_ORG_ALLOWLIST;
    else process.env.INNGEST_ASYNC_ORG_ALLOWLIST = originalAllowlist;
    if (originalEventKey === undefined) delete process.env.INNGEST_EVENT_KEY;
    else process.env.INNGEST_EVENT_KEY = originalEventKey;
  });

  it("defaults to inline when unset", () => {
    delete process.env.SCAN_SCHEDULER;
    expect(getScanSchedulerMode()).toBe("inline");
    expect(isInngestSchedulerEnabled()).toBe(false);
  });

  it("requires INNGEST_EVENT_KEY before enabling inngest for any organization", () => {
    process.env.SCAN_SCHEDULER = "inngest";
    delete process.env.INNGEST_ASYNC_ORG_ALLOWLIST;
    delete process.env.INNGEST_EVENT_KEY;
    expect(isInngestEnabledForOrganization("org-a")).toBe(false);
  });

  it("enables inngest globally when allowlist is unset", () => {
    process.env.SCAN_SCHEDULER = "inngest";
    process.env.INNGEST_EVENT_KEY = "test-event-key";
    delete process.env.INNGEST_ASYNC_ORG_ALLOWLIST;
    expect(isInngestEnabledForOrganization("org-a")).toBe(true);
    expect(isInngestEnabledForOrganization("org-b")).toBe(true);
  });

  it("restricts inngest to allowlisted organizations", () => {
    process.env.SCAN_SCHEDULER = "inngest";
    process.env.INNGEST_EVENT_KEY = "test-event-key";
    process.env.INNGEST_ASYNC_ORG_ALLOWLIST = "org-a, org-b";
    expect(isInngestEnabledForOrganization("org-a")).toBe(true);
    expect(isInngestEnabledForOrganization("org-c")).toBe(false);
  });
});
