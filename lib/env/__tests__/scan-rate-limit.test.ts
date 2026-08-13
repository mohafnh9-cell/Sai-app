import { afterEach, describe, expect, it } from "vitest";
import {
  isScanRateLimitDisabled,
  mcpReviewsPerOrganizationPerHourLimit,
  webScansPerRepositoryPerHourLimit,
} from "@/lib/env/scan-rate-limit";

describe("scan rate limit env", () => {
  const backup = { ...process.env };

  afterEach(() => {
    process.env = { ...backup };
  });

  it("disables limits when SCAN_RATE_LIMIT_DISABLED is set", () => {
    process.env.NODE_ENV = "production";
    process.env.SCAN_RATE_LIMIT_DISABLED = "1";
    expect(isScanRateLimitDisabled()).toBe(true);
    expect(webScansPerRepositoryPerHourLimit()).toBeNull();
    expect(mcpReviewsPerOrganizationPerHourLimit()).toBeNull();
  });

  it("disables limits outside production without explicit flag", () => {
    process.env.NODE_ENV = "development";
    delete process.env.SCAN_RATE_LIMIT_DISABLED;
    expect(isScanRateLimitDisabled()).toBe(true);
  });

  it("uses defaults in production when enabled", () => {
    process.env.NODE_ENV = "production";
    delete process.env.SCAN_RATE_LIMIT_DISABLED;
    process.env.SCAN_RATE_LIMIT_ENABLED = "1";
    expect(isScanRateLimitDisabled()).toBe(false);
    expect(webScansPerRepositoryPerHourLimit()).toBe(5);
    expect(mcpReviewsPerOrganizationPerHourLimit()).toBe(10);
  });

  it("enables limits in production by default", () => {
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    delete process.env.SCAN_RATE_LIMIT_DISABLED;
    delete process.env.SCAN_RATE_LIMIT_ENABLED;
    expect(isScanRateLimitDisabled()).toBe(false);
    expect(webScansPerRepositoryPerHourLimit()).toBe(5);
    expect(mcpReviewsPerOrganizationPerHourLimit()).toBe(10);
  });

  it("allows unlimited production scans when explicitly disabled", () => {
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    process.env.SCAN_RATE_LIMIT_DISABLED = "1";
    expect(isScanRateLimitDisabled()).toBe(true);
    expect(webScansPerRepositoryPerHourLimit()).toBeNull();
  });
});
