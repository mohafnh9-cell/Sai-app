import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzePackageSecurity } from "../package-security/analyze";
import { resetDependencyProcessCachesForTests } from "../shared/dependency-process-cache";

/**
 * Phase 18G -- deterministic, network-free benchmark simulating concurrent
 * scan bursts (10/25/50/100 "scans" starting within the same tick, each on
 * this one process -- the realistic scenario for a warm serverless
 * instance receiving several queued scans back to back). Uses a mock
 * transport with configurable latency; does NOT hit public registries at
 * these levels, per the phase's explicit instruction.
 *
 * Compares the current architecture (Phase 15 cache + Phase 18 in-flight
 * coalescing) against coalescing disabled (via the same kill switch),
 * holding everything else constant, to isolate exactly what coalescing
 * buys during a burst.
 */

const SIMULATED_LATENCY_MS = 30;

function file(path: string, content: string) {
  return { path, content };
}

/** Each simulated "scan" declares SHARED_COUNT popular packages (all scans overlap on these) plus a few scan-unique ones. */
function scanFiles(scanIndex: number, sharedCount: number, uniqueCount: number) {
  const dependencies: Record<string, string> = {};
  for (let i = 0; i < sharedCount; i++) {
    dependencies[`shared-popular-pkg-${i}`] = "^1.0.0"; // every scan wants these -- e.g. react, lodash, express
  }
  for (let i = 0; i < uniqueCount; i++) {
    dependencies[`scan-${scanIndex}-unique-pkg-${i}`] = "^1.0.0";
  }
  return [file("package.json", JSON.stringify({ dependencies }))];
}

function mockTransport() {
  let requestCount = 0;
  const fetchImpl = (async () => {
    requestCount += 1;
    await new Promise((resolve) => setTimeout(resolve, SIMULATED_LATENCY_MS));
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, getRequestCount: () => requestCount };
}

async function runBurst(concurrentScans: number, sharedCount: number, uniqueCount: number) {
  const { fetchImpl, getRequestCount } = mockTransport();
  const start = performance.now();
  await Promise.all(
    Array.from({ length: concurrentScans }, (_, i) =>
      analyzePackageSecurity(scanFiles(i, sharedCount, uniqueCount), { fetchImpl })
    )
  );
  const elapsedMs = performance.now() - start;
  const idealMinimum = sharedCount + concurrentScans * uniqueCount; // if there were zero coalescing benefit
  return { elapsedMs, actualRequests: getRequestCount(), idealMinimum };
}

describe("Phase 18G -- concurrent scan burst benchmark", () => {
  beforeEach(() => {
    resetDependencyProcessCachesForTests();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const SCAN_COUNTS = [10, 25, 50, 100];
  const SHARED_COUNT = 5; // e.g. react, lodash, express, axios, typescript
  const UNIQUE_COUNT = 2;

  it.each(SCAN_COUNTS)(
    "%i concurrent scans, coalescing ENABLED (current architecture)",
    async (concurrentScans) => {
      resetDependencyProcessCachesForTests();
      const result = await runBurst(concurrentScans, SHARED_COUNT, UNIQUE_COUNT);
      const naiveEstimate = concurrentScans * (SHARED_COUNT + UNIQUE_COUNT); // pre-Phase-15/18 world: zero sharing at all
      const reductionPct = Math.round((1 - result.actualRequests / naiveEstimate) * 100);

      console.log(
        `PHASE18_BURST_COALESCED ${JSON.stringify({
          concurrentScans,
          elapsedMs: Math.round(result.elapsedMs),
          actualRequests: result.actualRequests,
          naiveEstimateNoSharing: naiveEstimate,
          reductionPct,
        })}`
      );

      // With coalescing, the SHARED_COUNT popular packages should collapse
      // to (at most, allowing for some non-overlap in start timing) roughly
      // SHARED_COUNT real requests, not concurrentScans x SHARED_COUNT.
      expect(result.actualRequests).toBeLessThan(naiveEstimate);
      expect(result.actualRequests).toBeLessThanOrEqual(SHARED_COUNT + concurrentScans * UNIQUE_COUNT + SHARED_COUNT);
    },
    30_000
  );

  it.each(SCAN_COUNTS)(
    "%i concurrent scans, coalescing DISABLED (kill switch) -- shows the duplication coalescing eliminates",
    async (concurrentScans) => {
      resetDependencyProcessCachesForTests();
      vi.stubEnv("SEQURAI_DEP_CACHE_DISABLED", "1");
      const result = await runBurst(concurrentScans, SHARED_COUNT, UNIQUE_COUNT);

      console.log(
        `PHASE18_BURST_UNCOALESCED ${JSON.stringify({
          concurrentScans,
          elapsedMs: Math.round(result.elapsedMs),
          actualRequests: result.actualRequests,
        })}`
      );

      // Without any sharing, every scan independently requests all of its
      // own dependencies, including the popular ones every other scan also wants.
      expect(result.actualRequests).toBe(concurrentScans * (SHARED_COUNT + UNIQUE_COUNT));
    },
    30_000
  );
});
