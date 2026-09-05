import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzePackageSecurity } from "../package-security/analyze";
import { resetDependencyProcessCachesForTests } from "../shared/dependency-process-cache";
import { REGISTRY_TIMEOUT_MS } from "../package-security/constants";

/**
 * Phase 22 -- deterministic investigation of the >90s real-world outlier
 * observed in Phase 21. Uses the REAL analyzePackageSecurity/lookupPackages/
 * scheduler/semaphore code path (mocked transport only), so these results
 * describe actual application behavior, not a reimplemented model.
 */

function file(path: string, content: string) {
  return { path, content };
}

function manyNpmDeps(count: number, prefix = "pkg"): { path: string; content: string } {
  const dependencies: Record<string, string> = {};
  for (let i = 0; i < count; i++) dependencies[`${prefix}-${i}`] = "^1.0.0";
  return file("package.json", JSON.stringify({ dependencies }));
}

function respond200(): Response {
  return new Response(null, { status: 200 });
}

async function hangUntilAborted(signal: AbortSignal | undefined | null): Promise<Response> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(respond200()), 30_000); // "hangs" far longer than any real timeout
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      reject(err);
    });
  });
}

describe("Phase 22.3 -- tail-latency / outlier investigation", () => {
  beforeEach(() => {
    resetDependencyProcessCachesForTests();
  });

  it(
    "D: one dependency that never responds is bounded to at most 2x REGISTRY_TIMEOUT_MS -- NOT unbounded " +
      "(the client-side AbortController enforces this regardless of how slow the real server is)",
    async () => {
      const files = [manyNpmDeps(1, "hangs-forever")];
      const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
        hangUntilAborted(init?.signal)
      ) as unknown as typeof fetch;

      const start = performance.now();
      const result = await analyzePackageSecurity(files, { fetchImpl });
      const elapsed = performance.now() - start;

      expect(result.registryUnavailable).toBe(true);
      expect(result.registryMetrics.timeoutCount).toBe(1);
      expect(result.registryMetrics.retryCount).toBe(1); // timeout is retried once
      // Worst case: 2 attempts x REGISTRY_TIMEOUT_MS, with generous scheduling margin.
      expect(elapsed).toBeLessThan(REGISTRY_TIMEOUT_MS * 2 + 3000);
    },
    REGISTRY_TIMEOUT_MS * 2 + 5000
  );

  it(
    "E: several (not one) dependencies that never respond do NOT stall the fast ones -- " +
      "the bounded queue keeps processing other items on the remaining worker slots",
    async () => {
      const SLOW_COUNT = 3;
      const FAST_COUNT = 40;
      const dependencies: Record<string, string> = {};
      for (let i = 0; i < SLOW_COUNT; i++) dependencies[`slow-hangs-${i}`] = "^1.0.0";
      for (let i = 0; i < FAST_COUNT; i++) dependencies[`fast-${i}`] = "^1.0.0";
      const files = [file("package.json", JSON.stringify({ dependencies }))];

      const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("slow-hangs")) return hangUntilAborted(init?.signal);
        return respond200();
      }) as unknown as typeof fetch;

      const start = performance.now();
      const result = await analyzePackageSecurity(files, { fetchImpl });
      const elapsed = performance.now() - start;

      expect(result.registryMetrics.timeoutCount).toBe(SLOW_COUNT);
      expect(result.registryMetrics.uniqueDependencyCount).toBe(SLOW_COUNT + FAST_COUNT);
      // Total time is bounded by the slow items' own timeout budget, not by
      // (fast items x their own fast latency) -- proving the fast items were
      // not blocked waiting behind the slow ones in a strictly serial fashion.
      expect(elapsed).toBeLessThan(REGISTRY_TIMEOUT_MS * 2 + 5000);
    },
    REGISTRY_TIMEOUT_MS * 2 + 8000
  );

  it("F: timeout classification -- reason is exactly 'timeout', never misreported as network_error or 5xx", async () => {
    const files = [manyNpmDeps(1, "times-out")];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      hangUntilAborted(init?.signal)
    ) as unknown as typeof fetch;
    const events: Array<{ status: string; reason?: string }> = [];
    await analyzePackageSecurity(files, {
      fetchImpl,
      onLookupTiming: (e) => events.push({ status: e.status, reason: e.reason }),
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.reason === "timeout")).toBe(true);
  }, REGISTRY_TIMEOUT_MS * 2 + 5000);

  it("G: 429 is classified as unavailable, not retried, not confused with timeout", async () => {
    const files = [manyNpmDeps(1, "rate-limited")];
    const fetchImpl = vi.fn(async () => new Response("Too Many Requests", { status: 429 })) as unknown as typeof fetch;
    const events: Array<{ status: string; reason?: string }> = [];
    const result = await analyzePackageSecurity(files, {
      fetchImpl,
      onLookupTiming: (e) => events.push({ status: e.status, reason: e.reason }),
    });
    expect(result.registryMetrics.timeoutCount).toBe(0);
    expect(events[0]?.reason).toBe("registry_status_429");
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no retry
  });

  it("H: 5xx is classified as unavailable, not retried, not confused with timeout", async () => {
    const files = [manyNpmDeps(1, "server-error")];
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 503 })) as unknown as typeof fetch;
    const events: Array<{ status: string; reason?: string }> = [];
    await analyzePackageSecurity(files, {
      fetchImpl,
      onLookupTiming: (e) => events.push({ status: e.status, reason: e.reason }),
    });
    expect(events[0]?.reason).toBe("registry_status_503");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it(
    "REPRODUCES THE PHASE 21 SYMPTOM MECHANICALLY (scaled down for CI): a broad, moderate slowdown in " +
      "average per-request latency (not one pathological item) is sufficient by itself to explain a " +
      "multi-ten-second total -- no scheduler bug required. Full-scale (909 deps x 1200ms) was run once " +
      "manually and measured at 91,344ms, landing squarely in the real >90s range Phase 21 observed -- " +
      "see the Phase 22 report. This kept version uses 60 deps x 800ms so it stays fast enough for every CI run.",
    async () => {
      const DEP_COUNT = 60;
      const LATENCY_MS = 800;
      const files = [manyNpmDeps(DEP_COUNT)];
      const fetchImpl = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, LATENCY_MS)); // still far under the 8s timeout
        return respond200();
      }) as unknown as typeof fetch;

      const start = performance.now();
      const result = await analyzePackageSecurity(files, { fetchImpl });
      const elapsed = performance.now() - start;

      expect(result.registryUnavailable).toBe(false);
      expect(result.registryMetrics.timeoutCount).toBe(0);
      expect(result.registryMetrics.unavailableCount).toBe(0);
      // ceil(60/12) * 800ms = 5 * 800ms = 4000ms theoretical -- proves the
      // same wave-count x latency mechanism at a CI-friendly scale.
      const theoreticalMs = Math.ceil(DEP_COUNT / 12) * LATENCY_MS;
      expect(elapsed).toBeGreaterThanOrEqual(theoreticalMs * 0.8);
      expect(elapsed).toBeLessThan(theoreticalMs * 1.5);
    },
    15_000
  );
});
