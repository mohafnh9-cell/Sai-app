import { describe, expect, it } from "vitest";
import { lookupPackages } from "../package-security/registry-client";
import type { SbomEcosystem } from "../sbom/types";

/**
 * Phase 16B -- controlled, deterministic mock-transport benchmark for
 * REGISTRY_LOOKUP_CONCURRENCY. Exercises the REAL lookupPackages chunking/
 * retry/cache logic (via the Phase 16 `concurrency` option override), not a
 * reimplementation, against a mock transport with configurable latency and
 * injectable 429/5xx/timeout behavior.
 *
 * This mock does NOT represent npm's real rate limits or infrastructure --
 * its "concurrent in-flight requests > threshold => 429" rule is an
 * illustrative model chosen to make the *shape* of the risk visible (higher
 * concurrency CAN produce more rate-limit responses), not a measurement of
 * npm's actual behavior. Real registry evidence, if gathered, comes from a
 * separate, manually-invoked diagnostic script -- never this file.
 */

type MockOptions = {
  latencyMs: number;
  /** Requests that see more than this many others in flight get a 429. 0 = never. */
  rateLimitThreshold?: number;
  /** Fraction (0-1) of requests that get a 500 regardless of concurrency. */
  errorRate?: number;
  /** Fraction (0-1) of requests that never respond (simulating a hang -> caller's own timeout fires). */
  hangRate?: number;
};

function createMockRegistryTransport(opts: MockOptions) {
  let inFlight = 0;
  const requestLatencies: number[] = [];
  const counts = { success: 0, rateLimited: 0, serverError: 0, hung: 0, total: 0 };

  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    counts.total += 1;
    inFlight += 1;
    const started = performance.now();
    const signal = init?.signal;
    try {
      // Deterministic pseudo-random from the URL string so results are
      // reproducible across runs (no Math.random -- a flaky benchmark
      // would be worse than no benchmark).
      const str = String(url);
      let hash = 0;
      for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
      const pseudoRandom = (hash % 1000) / 1000;

      const delay = opts.hangRate && pseudoRandom < opts.hangRate ? 60_000 : opts.latencyMs;
      if (delay === 60_000) counts.hung += 1;

      // Respect the real AbortController lookupSingle/fetchWithTimeout
      // passes in -- without this, a simulated "hang" would hang the test
      // process for real instead of exercising the caller's own timeout.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });

      if (opts.rateLimitThreshold && inFlight > opts.rateLimitThreshold) {
        counts.rateLimited += 1;
        requestLatencies.push(performance.now() - started);
        return new Response("Too Many Requests", { status: 429 });
      }
      if (opts.errorRate && pseudoRandom < opts.errorRate) {
        counts.serverError += 1;
        requestLatencies.push(performance.now() - started);
        return new Response("Internal Server Error", { status: 500 });
      }

      counts.success += 1;
      requestLatencies.push(performance.now() - started);
      return new Response(JSON.stringify({ name: "pkg", version: "1.0.0" }), { status: 200 });
    } finally {
      inFlight -= 1;
    }
  }) as unknown as typeof fetch;

  return { fetchImpl, counts, requestLatencies };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function uniquePackages(count: number): Array<{ ecosystem: SbomEcosystem; name: string }> {
  return Array.from({ length: count }, (_, i) => ({ ecosystem: "npm" as const, name: `bench-pkg-${i}` }));
}

describe("Phase 16B -- REGISTRY_LOOKUP_CONCURRENCY benchmark (mock transport)", () => {
  const CONCURRENCY_LEVELS = [1, 2, 4, 8, 12, 16, 24, 32];
  const DEP_COUNT = 96; // divisible by every tested concurrency level for clean chunk math
  const LATENCY_MS = 25;

  it.each(CONCURRENCY_LEVELS)(
    "concurrency=%i: clean 200-only mock, no rate limiting",
    async (concurrency) => {
      const { fetchImpl, counts, requestLatencies } = createMockRegistryTransport({ latencyMs: LATENCY_MS });
      const start = performance.now();
      const results = await lookupPackages(uniquePackages(DEP_COUNT), { fetchImpl, concurrency });
      const totalMs = performance.now() - start;

      const sorted = [...requestLatencies].sort((a, b) => a - b);
      const report = {
        concurrency,
        depCount: DEP_COUNT,
        totalMs: Math.round(totalMs),
        theoreticalMs: Math.ceil(DEP_COUNT / concurrency) * LATENCY_MS,
        p50: Math.round(percentile(sorted, 50)),
        p95: Math.round(percentile(sorted, 95)),
        p99: Math.round(percentile(sorted, 99)),
        totalRequests: counts.total,
        success: counts.success,
        rateLimited: counts.rateLimited,
        serverError: counts.serverError,
      };
      console.log(`PHASE16_BENCH_CLEAN ${JSON.stringify(report)}`);

      expect(results.size).toBe(DEP_COUNT);
      expect(counts.success).toBe(DEP_COUNT);
      // Real duration should track the theoretical ceil(N/C)*L model within a generous margin.
      expect(totalMs).toBeGreaterThanOrEqual(report.theoreticalMs * 0.7);
    }
  );

  it.each([8, 12, 16, 24, 32])(
    "concurrency=%i: illustrative rate-limited mock (>8 concurrent in-flight => 429)",
    async (concurrency) => {
      // Models a hypothetical registry that tolerates at most 8 simultaneous
      // in-flight requests before rate-limiting -- illustrative only, not a
      // measured npm limit. Shows the *shape* of the real risk: at
      // concurrency <= the threshold, no 429s; above it, 429s appear and
      // (per lookupSingle's real retry-only-on-timeout behavior) are NOT
      // retried, so they surface as "unavailable" -- lost coverage, not just
      // lost time.
      const { fetchImpl, counts } = createMockRegistryTransport({
        latencyMs: LATENCY_MS,
        rateLimitThreshold: 8,
      });
      const results = await lookupPackages(uniquePackages(DEP_COUNT), { fetchImpl, concurrency });
      const unavailableCount = [...results.values()].filter((r) => r.status === "unavailable").length;

      console.log(
        `PHASE16_BENCH_RATE_LIMITED ${JSON.stringify({
          concurrency,
          success: counts.success,
          rateLimited429: counts.rateLimited,
          resultingUnavailable: unavailableCount,
        })}`
      );

      if (concurrency <= 8) {
        expect(counts.rateLimited).toBe(0);
      } else {
        // Above the illustrative threshold, some requests get 429'd --
        // demonstrating why "just raise concurrency" is not free.
        expect(counts.rateLimited).toBeGreaterThan(0);
        expect(unavailableCount).toBeGreaterThan(0);
      }
    }
  );

  it("timeout: a hung request is retried once (per lookupSingle's real retry-on-timeout logic), doubling its cost", async () => {
    const { fetchImpl } = createMockRegistryTransport({ latencyMs: 5, hangRate: 1 });
    const start = performance.now();
    const results = await lookupPackages(
      [{ ecosystem: "npm", name: "always-hangs" }],
      { fetchImpl, timeoutMs: 50, concurrency: 8 }
    );
    const elapsed = performance.now() - start;

    expect(results.get("npm:always-hangs")?.status).toBe("unavailable");
    // Two attempts at ~50ms timeout each (real retry-on-timeout behavior).
    expect(elapsed).toBeGreaterThanOrEqual(90);
  }, 10_000);

  it("5xx responses are NOT retried (unlike timeouts) -- confirms existing behavior is unchanged by the concurrency option", async () => {
    const { fetchImpl, counts } = createMockRegistryTransport({ latencyMs: 5, errorRate: 1 });
    await lookupPackages([{ ecosystem: "npm", name: "always-errors" }], { fetchImpl, concurrency: 8 });
    expect(counts.total).toBe(1); // one attempt only, no retry for 5xx
  });
});
