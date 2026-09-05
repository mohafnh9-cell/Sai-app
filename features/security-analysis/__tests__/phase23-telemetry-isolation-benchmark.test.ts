import { beforeEach, describe, expect, it } from "vitest";
import { analyzePackageSecurity } from "../package-security/analyze";
import {
  registryProcessConcurrencyForTests,
  resetDependencyProcessCachesForTests,
} from "../shared/dependency-process-cache";

/**
 * Phase 23.12 -- confirms telemetry (registryMetrics) stays correctly
 * isolated per scan under concurrent load, the process semaphore cap
 * remains exactly 32 (unchanged production default) regardless of scan
 * count, and telemetry collection itself doesn't materially slow anything
 * down. Deterministic mock transport -- no real registries touched.
 */

function file(path: string, content: string) {
  return { path, content };
}

function manyDeps(count: number, prefix: string): { path: string; content: string } {
  const dependencies: Record<string, string> = {};
  for (let i = 0; i < count; i++) dependencies[`${prefix}-${i}`] = "^1.0.0";
  return file("package.json", JSON.stringify({ dependencies }));
}

function mockTransport(latencyMs: number): typeof fetch {
  return (async () => {
    await new Promise((resolve) => setTimeout(resolve, latencyMs));
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
}

describe("Phase 23.12 -- telemetry isolation under concurrent scan load", () => {
  beforeEach(() => {
    resetDependencyProcessCachesForTests();
  });

  it.each([10, 25, 50, 100])(
    "%i concurrent scans: each scan's registryMetrics.uniqueDependencyCount matches only its own dependency set",
    async (scanCount) => {
      const fetchImpl = mockTransport(5);
      const DEPS_PER_SCAN = 8;

      const results = await Promise.all(
        Array.from({ length: scanCount }, (_, i) =>
          analyzePackageSecurity([manyDeps(DEPS_PER_SCAN, `iso-${i}`)], { fetchImpl })
        )
      );

      // Isolation check: no scan's metrics leaked another scan's dependency
      // count -- each independently declared exactly DEPS_PER_SCAN unique
      // (non-overlapping, per-scan-prefixed) names.
      for (const result of results) {
        expect(result.registryMetrics.uniqueDependencyCount).toBe(DEPS_PER_SCAN);
        expect(result.registryMetrics.dependencyCount).toBe(DEPS_PER_SCAN);
      }

      const { max } = registryProcessConcurrencyForTests();
      expect(max).toBe(32); // unchanged production default, regardless of scan count
    },
    30_000
  );

  it("telemetry collection overhead is negligible: a scan with instrumentation is not materially slower than the same scan without an onLookupTiming consumer", async () => {
    const DEP_COUNT = 100;
    const fetchImpl1 = mockTransport(5);
    const fetchImpl2 = mockTransport(5);

    resetDependencyProcessCachesForTests();
    const start1 = performance.now();
    await analyzePackageSecurity([manyDeps(DEP_COUNT, "no-consumer")], { fetchImpl: fetchImpl1 });
    const withoutConsumerMs = performance.now() - start1;

    resetDependencyProcessCachesForTests();
    let eventCount = 0;
    const start2 = performance.now();
    await analyzePackageSecurity([manyDeps(DEP_COUNT, "with-consumer")], {
      fetchImpl: fetchImpl2,
      onLookupTiming: () => {
        eventCount += 1;
      },
    });
    const withConsumerMs = performance.now() - start2;

    expect(eventCount).toBe(DEP_COUNT);
    // Telemetry is in-process aggregation only (no extra network calls) --
    // overhead should be a small fraction, not a multiplier.
    expect(withConsumerMs).toBeLessThan(withoutConsumerMs * 1.5 + 200);
  });
});
