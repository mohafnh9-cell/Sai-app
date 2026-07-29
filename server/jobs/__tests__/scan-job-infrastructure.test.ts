import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertScanJobsAvailableOrThrow,
  ScanJobInfrastructureError,
  isLegacyInlineScanFallbackAllowed,
} from "../scan-job-infrastructure";

describe("scan-job-infrastructure", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("disallows legacy fallback in production by default", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_LEGACY_INLINE_SCAN_FALLBACK", "");
    expect(isLegacyInlineScanFallbackAllowed()).toBe(false);
  });

  it("allows legacy fallback when explicitly enabled", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_LEGACY_INLINE_SCAN_FALLBACK", "1");
    expect(isLegacyInlineScanFallbackAllowed()).toBe(true);
  });

  it("throws ScanJobInfrastructureError in production when scan_jobs is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_LEGACY_INLINE_SCAN_FALLBACK", "");

    const pgError = new Error('Could not find the table "public.scan_jobs" in the schema cache');

    expect(() =>
      assertScanJobsAvailableOrThrow({
        error: pgError,
        organizationId: "org",
        projectId: "proj",
        scanId: "scan",
      })
    ).toThrow(ScanJobInfrastructureError);
  });

  it("does not throw for non-infrastructure errors", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() =>
      assertScanJobsAvailableOrThrow({
        error: new Error("other"),
        organizationId: "org",
        projectId: "proj",
        scanId: "scan",
      })
    ).not.toThrow();
  });
});
