import { describe, expect, it } from "vitest";

/**
 * Phase 19F/19H -- proves (or disproves) the chunk-barrier vs bounded-
 * streaming-queue hypothesis BEFORE touching production code. Both
 * scheduling models are implemented here standalone (mirroring
 * lookupPackages' exact chunk loop, and the proposed replacement), run
 * against identical, deterministic (seeded) per-item latencies drawn from
 * several distributions, holding peak concurrency at 8 for both. If the
 * queue does not show a material improvement, Phase 19 must not adopt it
 * merely because it looks architecturally cleaner.
 */

const CONCURRENCY = 8;

/** Deterministic PRNG (mulberry32) -- no Math.random, so results are reproducible. */
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
  constant_50ms: () => 50,
  mostly_50_some_250: (rand) => (rand() < 0.1 ? 250 : 50),
  mostly_50_some_500: (rand) => (rand() < 0.05 ? 500 : 50),
  heavy_tail_p50_50_p95_250_p99_650: (rand) => {
    const r = rand();
    if (r < 0.95) return 50;
    if (r < 0.99) return 250;
    return 650;
  },
};

function generateLatencies(count: number, distribution: Distribution, seed: number): number[] {
  const rand = seededRandom(seed);
  return Array.from({ length: count }, () => distribution(rand));
}

/** Mirrors lookupPackages' CURRENT chunk model exactly: wait for the whole chunk before starting the next. */
async function runChunkModel(latencies: number[], concurrency: number): Promise<{ totalMs: number; peakConcurrency: number }> {
  let peak = 0;
  let active = 0;
  const start = performance.now();
  for (let index = 0; index < latencies.length; index += concurrency) {
    const chunk = latencies.slice(index, index + concurrency);
    await Promise.all(
      chunk.map(async (ms) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, ms));
        active -= 1;
      })
    );
  }
  return { totalMs: performance.now() - start, peakConcurrency: peak };
}

/** Proposed replacement: a bounded worker pool -- a worker immediately pulls the next item on completion, no chunk barrier. */
async function runQueueModel(latencies: number[], concurrency: number): Promise<{ totalMs: number; peakConcurrency: number }> {
  let peak = 0;
  let active = 0;
  let index = 0;
  const start = performance.now();

  async function worker() {
    while (index < latencies.length) {
      const ms = latencies[index];
      index += 1;
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, ms));
      active -= 1;
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, latencies.length) }, () => worker());
  await Promise.all(workers);
  return { totalMs: performance.now() - start, peakConcurrency: peak };
}

describe("Phase 19H -- chunk-barrier vs bounded-queue scheduling benchmark", () => {
  const DEP_COUNTS = [100, 500, 900];

  for (const depCount of DEP_COUNTS) {
    for (const [distName, dist] of Object.entries(DISTRIBUTIONS)) {
      it(`${depCount} deps, distribution=${distName}`, async () => {
        const latencies = generateLatencies(depCount, dist, depCount * 7919 + distName.length);

        const chunk = await runChunkModel(latencies, CONCURRENCY);
        const queue = await runQueueModel(latencies, CONCURRENCY);

        const improvementPct = Math.round((1 - queue.totalMs / chunk.totalMs) * 100);

        console.log(
          `PHASE19_SCHEDULING ${JSON.stringify({
            depCount,
            distribution: distName,
            chunkModelMs: Math.round(chunk.totalMs),
            chunkPeakConcurrency: chunk.peakConcurrency,
            queueModelMs: Math.round(queue.totalMs),
            queuePeakConcurrency: queue.peakConcurrency,
            improvementPct,
          })}`
        );

        // Peak concurrency must never exceed 8 for either model -- this is
        // the non-negotiable constraint from Phase 16/19: no increase in
        // external-service pressure.
        expect(chunk.peakConcurrency).toBeLessThanOrEqual(CONCURRENCY);
        expect(queue.peakConcurrency).toBeLessThanOrEqual(CONCURRENCY);
      }, 30_000);
    }
  }

  it("constant latency: both models perform identically (no tail to exploit -- sanity check)", async () => {
    const latencies = generateLatencies(80, DISTRIBUTIONS.constant_50ms, 1);
    const chunk = await runChunkModel(latencies, CONCURRENCY);
    const queue = await runQueueModel(latencies, CONCURRENCY);
    // Should be within a small margin of each other -- constant latency
    // means every chunk's "slowest" request is the same as every other's,
    // so there's no idle time for the queue to reclaim.
    expect(Math.abs(chunk.totalMs - queue.totalMs)).toBeLessThan(60);
  });
});
