import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dependencyProcessCacheSizesForTests,
  isDependencyProcessCacheDisabled,
  promoteOsvResults,
  promoteRegistryResults,
  registryProcessConcurrencyForTests,
  resetDependencyProcessCachesForTests,
  seedOsvScanCacheFromProcess,
  seedRegistryScanCache,
  withRegistryProcessSlot,
} from "../dependency-process-cache";
import type { RegistryLookupResult } from "../../package-security/types";
import type { OsvApiVulnerability } from "../../osv/types";

/**
 * Phase 15 -- the cross-scan cache is what turns repeated dependency
 * lookups into cache hits instead of new network calls. These tests prove
 * the cache mechanics directly (hit/miss/promotion/expiry/kill-switch);
 * dependency-intelligence-rule-level tests already cover that a seeded hit
 * means analyzePackageSecurity/analyzeOsvSbomEvidence skip the network
 * call entirely (see package-security.test.ts / osv-enrich-sbom.test.ts).
 */

beforeEach(() => {
  resetDependencyProcessCachesForTests();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("registry process cache", () => {
  it("cache miss: an unseeded key returns nothing", () => {
    const seeded = seedRegistryScanCache(["npm:left-pad"]);
    expect(seeded.size).toBe(0);
  });

  it("cache hit: a promoted 'exists' result is reused by a later scan", () => {
    const results = new Map<string, RegistryLookupResult>([
      ["npm:left-pad", { status: "exists", registryUrl: "https://registry.npmjs.org/left-pad" }],
    ]);
    promoteRegistryResults(results);

    // Simulates a second, independent scan (e.g. a rescan, or a different
    // org's repo declaring the same popular package).
    const seeded = seedRegistryScanCache(["npm:left-pad"]);
    expect(seeded.get("npm:left-pad")).toEqual({
      status: "exists",
      registryUrl: "https://registry.npmjs.org/left-pad",
    });
  });

  it("cache hit: a promoted 'not_found' result is reused (stable fact -- a real hallucination stays a hallucination)", () => {
    const results = new Map<string, RegistryLookupResult>([
      ["npm:definitely-hallucinated-pkg-xyz", { status: "not_found" }],
    ]);
    promoteRegistryResults(results);

    const seeded = seedRegistryScanCache(["npm:definitely-hallucinated-pkg-xyz"]);
    expect(seeded.get("npm:definitely-hallucinated-pkg-xyz")?.status).toBe("not_found");
  });

  it("SECURITY: never promotes 'unavailable' -- a transient outage must not poison later scans", () => {
    const results = new Map<string, RegistryLookupResult>([
      ["npm:some-package", { status: "unavailable", reason: "timeout" }],
    ]);
    promoteRegistryResults(results);

    const seeded = seedRegistryScanCache(["npm:some-package"]);
    expect(seeded.size).toBe(0);
    expect(dependencyProcessCacheSizesForTests().registry).toBe(0);
  });

  it("does not promote 'skipped' (unsupported ecosystem) -- nothing useful to cache", () => {
    const results = new Map<string, RegistryLookupResult>([
      ["unsupported:pkg", { status: "skipped", reason: "unsupported_ecosystem" }],
    ]);
    promoteRegistryResults(results);
    expect(dependencyProcessCacheSizesForTests().registry).toBe(0);
  });

  it("expires after the TTL -- a stale entry is treated as a miss, not silently reused forever", () => {
    vi.useFakeTimers();
    promoteRegistryResults(
      new Map([["npm:left-pad", { status: "exists" } as RegistryLookupResult]])
    );
    expect(seedRegistryScanCache(["npm:left-pad"]).size).toBe(1);

    vi.advanceTimersByTime(61 * 60_000); // past the default 60-minute registry TTL
    expect(seedRegistryScanCache(["npm:left-pad"]).size).toBe(0);
  });

  it("kill switch (SEQURAI_DEP_CACHE_DISABLED): falls back to per-scan-only behavior instantly", () => {
    promoteRegistryResults(
      new Map([["npm:left-pad", { status: "exists" } as RegistryLookupResult]])
    );
    expect(seedRegistryScanCache(["npm:left-pad"]).size).toBe(1);

    vi.stubEnv("SEQURAI_DEP_CACHE_DISABLED", "1");
    expect(isDependencyProcessCacheDisabled()).toBe(true);
    expect(seedRegistryScanCache(["npm:left-pad"]).size).toBe(0);
  });
});

describe("OSV process cache", () => {
  const vulns: OsvApiVulnerability[] = [
    { id: "GHSA-xxxx", summary: "test", aliases: ["CVE-2021-0000"] } as OsvApiVulnerability,
  ];

  it("cache miss then hit across two simulated scans of the same package@version", () => {
    const key = "npm:lodash@4.17.20";
    expect(seedOsvScanCacheFromProcess([key]).size).toBe(0);

    promoteOsvResults(new Map([[key, vulns]]));

    const secondScanSeed = seedOsvScanCacheFromProcess([key]);
    expect(secondScanSeed.get(key)).toEqual(vulns);
  });

  it("caches a genuine empty result too -- 'checked, currently clean' is real intelligence, not a failure", () => {
    const key = "npm:left-pad@1.3.0";
    promoteOsvResults(new Map([[key, []]]));
    const seeded = seedOsvScanCacheFromProcess([key]);
    expect(seeded.get(key)).toEqual([]);
  });

  it("expires after the shorter OSV TTL (correctness over hit rate: new CVEs can appear at any time)", () => {
    vi.useFakeTimers();
    const key = "npm:lodash@4.17.20";
    promoteOsvResults(new Map([[key, vulns]]));
    expect(seedOsvScanCacheFromProcess([key]).size).toBe(1);

    vi.advanceTimersByTime(16 * 60_000); // past the default 15-minute OSV TTL
    expect(seedOsvScanCacheFromProcess([key]).size).toBe(0);
  });

  it("kill switch disables OSV cross-scan reuse too", () => {
    const key = "npm:lodash@4.17.20";
    promoteOsvResults(new Map([[key, vulns]]));
    vi.stubEnv("SEQURAI_DEP_CACHE_DISABLED", "1");
    expect(seedOsvScanCacheFromProcess([key]).size).toBe(0);
  });
});

describe("Phase 21 -- process-level aggregate registry concurrency cap", () => {
  it("caps total simultaneous work across many independent callers at the configured max", async () => {
    const { max } = registryProcessConcurrencyForTests();
    let active = 0;
    let peak = 0;
    const callCount = max * 3; // deliberately far more callers than slots

    await Promise.all(
      Array.from({ length: callCount }, () =>
        withRegistryProcessSlot(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
        })
      )
    );

    expect(peak).toBeLessThanOrEqual(max);
    expect(peak).toBeGreaterThan(0);
  });

  it("releases the slot even when the wrapped function throws (no leak on failure)", async () => {
    const { max } = registryProcessConcurrencyForTests();
    // Exhaust all slots concurrently with functions that hold briefly then throw.
    const failures = await Promise.allSettled(
      Array.from({ length: max }, () =>
        withRegistryProcessSlot(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          throw new Error("simulated registry failure");
        })
      )
    );
    expect(failures.every((r) => r.status === "rejected")).toBe(true);

    // If slots leaked, this would hang (never acquire) -- proves cleanup happened.
    let ran = false;
    await withRegistryProcessSlot(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("kill switch disables the process cap -- callers run immediately, unbounded", async () => {
    vi.stubEnv("SEQURAI_DEP_CACHE_DISABLED", "1");
    let ran = false;
    await withRegistryProcessSlot(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
