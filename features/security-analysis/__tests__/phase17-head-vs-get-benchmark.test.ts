import { describe, expect, it } from "vitest";
import { lookupPackages } from "../package-security/registry-client";
import type { SbomEcosystem } from "../sbom/types";

/**
 * Phase 17E -- deterministic, network-free benchmark demonstrating the
 * actual benefit of the per-ecosystem HEAD strategy: eliminating response
 * body transfer/buffering/parsing for npm/pypi/rubygems, while crates/go
 * (still GET) see no change. Uses realistic simulated body sizes (npm's
 * real react response was measured at ~6.9MB in Phase 16/17's live
 * diagnostic) rather than claiming a production speedup from mock latency
 * alone -- the metric that matters here is bytes transferred and parse
 * work avoided, which IS accurately modeled by a mock (bytes are bytes
 * regardless of network origin), not the network latency itself.
 */

const REALISTIC_NPM_BODY_BYTES = 500_000; // representative mid-size package metadata; react's is an outlier at ~6.9MB
const SIMULATED_LATENCY_MS = 20;

function largeJsonBody(bytes: number): string {
  // Realistic-shaped payload: an object with padding, not just a giant string,
  // so JSON.parse (if ever invoked) does comparable work to a real npm response.
  const versions: Record<string, { dist: { shasum: string } }> = {};
  let approxBytes = 0;
  let i = 0;
  while (approxBytes < bytes) {
    const v = `1.0.${i}`;
    versions[v] = { dist: { shasum: "a".repeat(40) } };
    approxBytes += 70;
    i += 1;
  }
  return JSON.stringify({ name: "pkg", versions });
}

function mockTransportWithBodyTracking(bodyBytesForGet: number) {
  let totalBytesTransferred = 0;
  let getRequests = 0;
  let headRequests = 0;

  const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    await new Promise((resolve) => setTimeout(resolve, SIMULATED_LATENCY_MS));
    if (method === "HEAD") {
      headRequests += 1;
      // A real HEAD response transfers headers only -- no body bytes.
      return new Response(null, { status: 200 });
    }
    getRequests += 1;
    const body = largeJsonBody(bodyBytesForGet);
    totalBytesTransferred += body.length;
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;

  return {
    fetchImpl,
    getStats: () => ({ totalBytesTransferred, getRequests, headRequests }),
  };
}

function uniquePackages(count: number, ecosystem: SbomEcosystem): Array<{ ecosystem: SbomEcosystem; name: string }> {
  return Array.from({ length: count }, (_, i) => ({ ecosystem, name: `bench-pkg-${i}` }));
}

describe("Phase 17E -- HEAD vs GET response-body benchmark", () => {
  it.each([10, 50, 100, 200])(
    "npm (HEAD-strategy), %i dependencies: zero body bytes transferred",
    async (depCount) => {
      const { fetchImpl, getStats } = mockTransportWithBodyTracking(REALISTIC_NPM_BODY_BYTES);
      const start = performance.now();
      const results = await lookupPackages(uniquePackages(depCount, "npm"), { fetchImpl, concurrency: 8 });
      const elapsedMs = performance.now() - start;
      const stats = getStats();

      console.log(
        `PHASE17_BENCH_HEAD ${JSON.stringify({ ecosystem: "npm", depCount, elapsedMs: Math.round(elapsedMs), ...stats })}`
      );

      expect(results.size).toBe(depCount);
      expect(stats.headRequests).toBe(depCount);
      expect(stats.getRequests).toBe(0);
      expect(stats.totalBytesTransferred).toBe(0);
    }
  );

  it.each([10, 50, 100, 200])(
    "crates (GET-strategy, unchanged), %i dependencies: full body still transferred (baseline, no regression, no false improvement claimed)",
    async (depCount) => {
      const { fetchImpl, getStats } = mockTransportWithBodyTracking(REALISTIC_NPM_BODY_BYTES);
      const results = await lookupPackages(uniquePackages(depCount, "crates"), { fetchImpl, concurrency: 8 });
      const stats = getStats();

      console.log(`PHASE17_BENCH_GET ${JSON.stringify({ ecosystem: "crates", depCount, ...stats })}`);

      expect(results.size).toBe(depCount);
      expect(stats.getRequests).toBe(depCount);
      expect(stats.headRequests).toBe(0);
      expect(stats.totalBytesTransferred).toBeGreaterThan(0);
    }
  );

  it("quantifies the byte reduction for a mixed realistic dependency set (npm-heavy, matching typical JS repos)", async () => {
    const { fetchImpl, getStats } = mockTransportWithBodyTracking(REALISTIC_NPM_BODY_BYTES);
    const npmDeps = uniquePackages(90, "npm");
    const cratesDeps = uniquePackages(10, "crates");
    await lookupPackages([...npmDeps, ...cratesDeps], { fetchImpl, concurrency: 8 });
    const stats = getStats();

    // Before Phase 17 (all GET): 100 requests x ~500KB ~= 50MB transferred.
    const beforeEstimateBytes = 100 * REALISTIC_NPM_BODY_BYTES;
    const reductionPct = Math.round((1 - stats.totalBytesTransferred / beforeEstimateBytes) * 100);

    console.log(
      `PHASE17_BYTES_REDUCTION ${JSON.stringify({
        beforeEstimateBytes,
        afterActualBytes: stats.totalBytesTransferred,
        reductionPct,
      })}`
    );

    expect(stats.headRequests).toBe(90);
    expect(stats.getRequests).toBe(10);
    // Only the 10 crates lookups transferred bodies -- roughly 90% reduction for this mix.
    expect(reductionPct).toBeGreaterThan(85);
  });
});
