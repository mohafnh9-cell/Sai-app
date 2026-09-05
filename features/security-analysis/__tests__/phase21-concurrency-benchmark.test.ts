import { describe, expect, it } from "vitest";

/**
 * Phase 21E/F/G -- deterministic mock benchmarks for the concurrency
 * investigation. All latency/rate-limit behavior here is an illustrative
 * MODEL, not a claim about real npm/PyPI/etc infrastructure -- real
 * evidence (small, safe, manual) is gathered separately and reported on
 * its own in the Phase 21 report, never conflated with these numbers.
 */

function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Distribution = (rand: () => number) => number;
const DISTRIBUTIONS: Record<string, Distribution> = {
  uniform_50ms: () => 50,
  moderate_variance: (rand) => (rand() < 0.15 ? 200 : 50),
  heavy_tail_p50_50_p95_250_p99_650: (rand) => {
    const r = rand();
    if (r < 0.95) return 50;
    if (r < 0.99) return 250;
    return 650;
  },
};

/** Bounded worker pool -- identical shape to the real production runBoundedQueue (registry-client.ts). */
async function runBoundedQueue<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let nextIndex = 0;
  async function runOneWorker() {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  }
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runOneWorker()));
}

/** Simple counting semaphore -- candidate process-level aggregate limiter (Phase 21C). Not wired into production yet. */
class Semaphore {
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
  private release() {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}

type MockResult = { ok: true } | { ok: false; kind: "429" | "5xx" | "timeout" };

function createMockRegistry(opts: { rateLimitThreshold: number; distribution: Distribution; seed: number }) {
  const rand = seededRandom(opts.seed);
  let inFlight = 0;
  let peakInFlight = 0;
  const stats = { success: 0, rateLimited: 0, serverError: 0, timeout: 0, total: 0 };
  const latencies: number[] = [];

  async function request(): Promise<MockResult> {
    stats.total += 1;
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    const start = performance.now();
    try {
      const ms = opts.distribution(rand);
      await new Promise((resolve) => setTimeout(resolve, ms));
      latencies.push(performance.now() - start);
      if (opts.rateLimitThreshold > 0 && inFlight > opts.rateLimitThreshold) {
        stats.rateLimited += 1;
        return { ok: false, kind: "429" };
      }
      stats.success += 1;
      return { ok: true };
    } finally {
      inFlight -= 1;
    }
  }

  return { request, stats, latencies, getPeakInFlight: () => peakInFlight };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

describe("Phase 21E -- mock rate-limited transport mechanism check", () => {
  it.each([8, 12, 16, 24, 32])(
    "threshold=8 (illustrative model), concurrency=%i: verifies 429s appear above and not at/below the threshold",
    async (concurrency) => {
      const registry = createMockRegistry({ rateLimitThreshold: 8, distribution: DISTRIBUTIONS.uniform_50ms, seed: 1 });
      const items = Array.from({ length: 80 }, (_, i) => i);
      await runBoundedQueue(items, concurrency, async () => {
        await registry.request();
      });
      if (concurrency <= 8) {
        expect(registry.stats.rateLimited).toBe(0);
      } else {
        expect(registry.stats.rateLimited).toBeGreaterThan(0);
      }
    }
  );
});

describe("Phase 21F -- single-scan concurrency sweep (909 dependencies)", () => {
  const CONCURRENCY_LEVELS = [4, 8, 12, 16, 24, 32];
  const DEP_COUNT = 909;

  for (const [distName, dist] of Object.entries(DISTRIBUTIONS)) {
    for (const concurrency of CONCURRENCY_LEVELS) {
      it(`${DEP_COUNT} deps, distribution=${distName}, concurrency=${concurrency}`, async () => {
        // No rate limit in this sweep -- isolates pure scheduling/latency
        // effect of concurrency, matching Phase 21F's "benchmark concurrency"
        // instruction (rate-limit risk is evaluated separately in the
        // threshold-crossing test above and in the real diagnostic).
        const registry = createMockRegistry({ rateLimitThreshold: 0, distribution: dist, seed: DEP_COUNT * 13 + concurrency });
        const items = Array.from({ length: DEP_COUNT }, (_, i) => i);
        const start = performance.now();
        await runBoundedQueue(items, concurrency, async () => {
          await registry.request();
        });
        const totalMs = performance.now() - start;
        const sorted = [...registry.latencies].sort((a, b) => a - b);

        console.log(
          `PHASE21_SINGLE_SCAN ${JSON.stringify({
            distribution: distName,
            concurrency,
            totalMs: Math.round(totalMs),
            p50: Math.round(percentile(sorted, 50)),
            p95: Math.round(percentile(sorted, 95)),
            max: Math.round(sorted[sorted.length - 1] ?? 0),
            peakInFlight: registry.getPeakInFlight(),
            errors: registry.stats.rateLimited + registry.stats.serverError + registry.stats.timeout,
          })}`
        );

        expect(registry.getPeakInFlight()).toBeLessThanOrEqual(concurrency);
      }, 30_000);
    }
  }
});

describe("Phase 21G -- multi-scan pressure: Model A (per-scan only) vs Model C (per-scan + process cap)", () => {
  function scanDeps(scanIndex: number, sharedCount: number, uniqueCount: number): number[] {
    // Encode as numbers where < sharedCount means "shared popular dep",
    // else a scan-unique id -- mirrors Phase 18's overlap model.
    const shared = Array.from({ length: sharedCount }, (_, i) => i);
    const unique = Array.from({ length: uniqueCount }, (_, i) => 1000 + scanIndex * 1000 + i);
    return [...shared, ...unique];
  }

  const SCAN_COUNTS = [10, 25, 50, 100];
  const SHARED_COUNT = 5;
  const UNIQUE_COUNT = 95; // ~100 unique deps per scan, per Phase 21G's spec

  it.each(SCAN_COUNTS)("%i scans -- Model A: per-scan concurrency=16, NO process cap", async (scanCount) => {
    const registry = createMockRegistry({ rateLimitThreshold: 0, distribution: DISTRIBUTIONS.uniform_50ms, seed: scanCount });
    // In-flight coalescing model: a real key already being fetched is shared.
    const inFlightKeys = new Map<number, Promise<void>>();
    async function fetchKey(key: number) {
      const existing = inFlightKeys.get(key);
      if (existing) return existing;
      const p = registry.request().then(() => {}).finally(() => inFlightKeys.delete(key));
      inFlightKeys.set(key, p);
      return p;
    }

    const start = performance.now();
    await Promise.all(
      Array.from({ length: scanCount }, (_, i) =>
        runBoundedQueue(scanDeps(i, SHARED_COUNT, UNIQUE_COUNT), 16, async (key) => {
          await fetchKey(key);
        })
      )
    );
    const totalMs = performance.now() - start;

    console.log(
      `PHASE21_MULTISCAN_A ${JSON.stringify({
        scanCount,
        totalMs: Math.round(totalMs),
        realRequests: registry.stats.total,
        peakProcessConcurrency: registry.getPeakInFlight(),
      })}`
    );
    expect(registry.getPeakInFlight()).toBeGreaterThan(0);
  }, 60_000);

  it.each(SCAN_COUNTS)("%i scans -- Model C: per-scan concurrency=16, process cap=32", async (scanCount) => {
    const registry = createMockRegistry({ rateLimitThreshold: 0, distribution: DISTRIBUTIONS.uniform_50ms, seed: scanCount });
    const processCap = new Semaphore(32);
    const inFlightKeys = new Map<number, Promise<void>>();
    async function fetchKey(key: number) {
      const existing = inFlightKeys.get(key);
      if (existing) return existing;
      const p = (async () => {
        const release = await processCap.acquire();
        try {
          await registry.request();
        } finally {
          release();
        }
      })().finally(() => inFlightKeys.delete(key));
      inFlightKeys.set(key, p);
      return p;
    }

    const start = performance.now();
    await Promise.all(
      Array.from({ length: scanCount }, (_, i) =>
        runBoundedQueue(scanDeps(i, SHARED_COUNT, UNIQUE_COUNT), 16, async (key) => {
          await fetchKey(key);
        })
      )
    );
    const totalMs = performance.now() - start;

    console.log(
      `PHASE21_MULTISCAN_C ${JSON.stringify({
        scanCount,
        totalMs: Math.round(totalMs),
        realRequests: registry.stats.total,
        peakProcessConcurrency: registry.getPeakInFlight(),
      })}`
    );
    // The whole point of Model C: peak process concurrency is capped at 32
    // regardless of how many scans are running simultaneously.
    expect(registry.getPeakInFlight()).toBeLessThanOrEqual(32);
  }, 90_000);
});
