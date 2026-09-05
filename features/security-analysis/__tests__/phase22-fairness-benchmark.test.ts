import { beforeEach, describe, expect, it } from "vitest";
import { analyzePackageSecurity } from "../package-security/analyze";
import { resetDependencyProcessCachesForTests } from "../shared/dependency-process-cache";

/**
 * Phase 22.5/22.6 -- fairness under the shared process semaphore, and
 * process-cap benchmark (8/16/32/48, current production default is 32).
 *
 * IMPORTANT on 22.6: the real process-level semaphore's cap
 * (SEQURAI_REGISTRY_PROCESS_CONCURRENCY) is read once at module load in
 * dependency-process-cache.ts, not per-call -- so it cannot be swapped at
 * runtime via vi.stubEnv within one test process (discovered while writing
 * this benchmark; the module-level cap stays fixed for the process's
 * lifetime by design, which is correct for production but means it can't be
 * exercised at multiple values in-process here). This benchmark instead
 * uses a standalone semaphore with the exact same acquire/release logic as
 * the real one, parameterized directly by the value under test -- this
 * measures the real *mechanism*, not a reimplementation of different logic,
 * while never touching or reconfiguring the actual production semaphore.
 */

class BenchmarkSemaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active += 1;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve(() => this.release());
      });
    });
  }
  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}

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

describe("Phase 22.5 -- fairness: does one large scan starve small scans sharing the process semaphore?", () => {
  beforeEach(() => {
    resetDependencyProcessCachesForTests();
  });

  it("1 scan x 900 deps + 20 scans x 10 deps: small scans still complete promptly, not stuck behind the large scan", async () => {
    const fetchImpl = mockTransport(20);
    const largeScan = analyzePackageSecurity([manyDeps(900, "large")], { fetchImpl });

    const smallScanTimes: number[] = [];
    const smallScans = Array.from({ length: 20 }, async (_, i) => {
      const start = performance.now();
      await analyzePackageSecurity([manyDeps(10, `small-${i}`)], { fetchImpl });
      smallScanTimes.push(performance.now() - start);
    });

    await Promise.all([largeScan, ...smallScans]);

    const maxSmallTime = Math.max(...smallScanTimes);
    console.log(
      `PHASE22_FAIRNESS ${JSON.stringify({
        scenario: "1x900 + 20x10",
        maxSmallScanMs: Math.round(maxSmallTime),
        avgSmallScanMs: Math.round(smallScanTimes.reduce((a, b) => a + b, 0) / smallScanTimes.length),
      })}`
    );

    // Not a hard architectural guarantee (no priority scheduling exists) --
    // this documents observed behavior. A small scan (10 deps at
    // concurrency<=12, sharing a 32-slot process cap with a 900-dep scan)
    // should still complete in low seconds, not tens of seconds.
    expect(maxSmallTime).toBeLessThan(10_000);
  }, 60_000);

  it("10 large scans (100 deps each) + 50 small scans (10 deps each): small scans are not pathologically starved", async () => {
    const fetchImpl = mockTransport(15);
    const largeScans = Array.from({ length: 10 }, (_, i) =>
      analyzePackageSecurity([manyDeps(100, `large-${i}`)], { fetchImpl })
    );

    const smallScanTimes: number[] = [];
    const smallScans = Array.from({ length: 50 }, async (_, i) => {
      const start = performance.now();
      await analyzePackageSecurity([manyDeps(10, `tiny-${i}`)], { fetchImpl });
      smallScanTimes.push(performance.now() - start);
    });

    await Promise.all([...largeScans, ...smallScans]);
    const maxSmallTime = Math.max(...smallScanTimes);
    console.log(
      `PHASE22_FAIRNESS ${JSON.stringify({
        scenario: "10x100 + 50x10",
        maxSmallScanMs: Math.round(maxSmallTime),
      })}`
    );
    expect(maxSmallTime).toBeLessThan(15_000);
  }, 90_000);
});

describe("Phase 22.6 -- process cap comparison (benchmark only, production default unchanged at 32)", () => {
  it.each([8, 16, 32, 48])(
    "cap=%i: 10 concurrent scans x 80 deps x 12-wide per-scan queue, measures throughput/tail/fairness",
    async (cap) => {
      const semaphore = new BenchmarkSemaphore(cap);
      const PER_SCAN_CONCURRENCY = 12;
      const LATENCY_MS = 25;

      async function runScan(depCount: number): Promise<number> {
        const start = performance.now();
        let nextIndex = 0;
        async function worker() {
          while (nextIndex < depCount) {
            nextIndex += 1;
            const release = await semaphore.acquire();
            try {
              await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
            } finally {
              release();
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(PER_SCAN_CONCURRENCY, depCount) }, () => worker()));
        return performance.now() - start;
      }

      const start = performance.now();
      const scanTimes = await Promise.all(Array.from({ length: 10 }, () => runScan(80)));
      const totalMs = performance.now() - start;
      const sorted = [...scanTimes].sort((a, b) => a - b);

      console.log(
        `PHASE22_PROCESS_CAP ${JSON.stringify({
          cap,
          totalMs: Math.round(totalMs),
          maxScanMs: Math.round(sorted[sorted.length - 1]),
          minScanMs: Math.round(sorted[0]),
        })}`
      );
      expect(sorted[sorted.length - 1]).toBeGreaterThan(0);
    },
    60_000
  );
});
