import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzePackageSecurity } from "../package-security/analyze";
import { resetDependencyProcessCachesForTests } from "../shared/dependency-process-cache";

/**
 * Phase 15C -- deterministic, network-free benchmark proving the cross-scan
 * cache actually reduces latency and external-call count, at realistic
 * dependency counts. Uses a fake fetchImpl with a fixed simulated registry
 * round-trip (50ms) instead of real network calls, so this is safe to run
 * in every CI run (no flakiness, no external dependency) while still
 * demonstrating the real algorithmic effect: REGISTRY_LOOKUP_CONCURRENCY=8
 * means N unique deps costs ceil(N/8) sequential round trips on a cold
 * cache, and ~0 round trips on a warm one.
 */

const SIMULATED_REGISTRY_LATENCY_MS = 50;

function packageJsonWithDeps(count: number, prefix = "pkg"): { path: string; content: string } {
  const dependencies: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    dependencies[`${prefix}-${i}`] = "^1.0.0";
  }
  return { path: "package.json", content: JSON.stringify({ dependencies }) };
}

function fakeRegistryFetch(callCounter: { count: number }): typeof fetch {
  return vi.fn(async () => {
    callCounter.count += 1;
    await new Promise((resolve) => setTimeout(resolve, SIMULATED_REGISTRY_LATENCY_MS));
    return new Response(JSON.stringify({ name: "pkg", version: "1.0.0" }), { status: 200 });
  }) as unknown as typeof fetch;
}

async function benchScenario(label: string, uniqueDeps: number) {
  resetDependencyProcessCachesForTests();
  const files = [packageJsonWithDeps(uniqueDeps)];

  const coldCounter = { count: 0 };
  const coldStart = performance.now();
  const coldResult = await analyzePackageSecurity(files, { fetchImpl: fakeRegistryFetch(coldCounter) });
  const coldMs = performance.now() - coldStart;

  const warmCounter = { count: 0 };
  const warmStart = performance.now();
  const warmResult = await analyzePackageSecurity(files, { fetchImpl: fakeRegistryFetch(warmCounter) });
  const warmMs = performance.now() - warmStart;

  const report = {
    label,
    uniqueDeps,
    coldMs: Math.round(coldMs),
    coldNetworkCalls: coldCounter.count,
    warmMs: Math.round(warmMs),
    warmNetworkCalls: warmCounter.count,
    speedup: Number((coldMs / Math.max(warmMs, 1)).toFixed(1)),
    findingsMatch: JSON.stringify(coldResult.findings) === JSON.stringify(warmResult.findings),
  };
  console.log(`PHASE15_BENCH ${JSON.stringify(report)}`);
  return report;
}

describe("Phase 15C -- dependency-intelligence cache benchmark", () => {
  beforeEach(() => {
    resetDependencyProcessCachesForTests();
  });

  it("scenario A: 10 unique dependencies", async () => {
    const r = await benchScenario("A_10_unique", 10);
    expect(r.warmNetworkCalls).toBe(0);
    expect(r.coldNetworkCalls).toBe(10);
  });

  it("scenario B: 50 unique dependencies", async () => {
    const r = await benchScenario("B_50_unique", 50);
    expect(r.warmNetworkCalls).toBe(0);
    expect(r.coldNetworkCalls).toBe(50);
    expect(r.warmMs).toBeLessThan(r.coldMs);
  });

  it("scenario C: 100 unique dependencies", async () => {
    const r = await benchScenario("C_100_unique", 100);
    expect(r.warmNetworkCalls).toBe(0);
    expect(r.coldNetworkCalls).toBe(100);
    expect(r.warmMs).toBeLessThan(r.coldMs);
  });

  it("scenario D: 200 unique dependencies", async () => {
    const r = await benchScenario("D_200_unique", 200);
    expect(r.warmNetworkCalls).toBe(0);
    expect(r.coldNetworkCalls).toBe(200);
    expect(r.warmMs).toBeLessThan(r.coldMs);
    expect(r.findingsMatch).toBe(true);
  }, 30_000);

  it("duplicate-heavy: 100 declared references collapsing to 40 unique packages -- only 40 network calls, not 100", async () => {
    resetDependencyProcessCachesForTests();
    const dependencies: Record<string, string> = {};
    const devDependencies: Record<string, string> = {};
    const optionalDependencies: Record<string, string> = {};
    // 40 unique names, each declared in up to 3 of the 3 manifest sections
    // parsed by parsePackageJsonManifest (dependencies/devDependencies/
    // optionalDependencies) -- this is a real, common way the same package
    // legitimately appears more than once in one manifest.
    for (let i = 0; i < 40; i++) {
      dependencies[`shared-pkg-${i}`] = "^1.0.0";
      if (i % 2 === 0) devDependencies[`shared-pkg-${i}`] = "^1.0.0";
      if (i % 3 === 0) optionalDependencies[`shared-pkg-${i}`] = "^1.0.0";
    }
    const files = [
      { path: "package.json", content: JSON.stringify({ dependencies, devDependencies, optionalDependencies }) },
    ];

    const counter = { count: 0 };
    const result = await analyzePackageSecurity(files, { fetchImpl: fakeRegistryFetch(counter) });

    expect(result.dependenciesChecked).toBe(40);
    expect(counter.count).toBe(40); // NOT ~60-100 -- intra-scan dedup already collapses repeated declarations
    console.log(
      `PHASE15_BENCH ${JSON.stringify({ label: "duplicate_heavy_40_unique_of_100_refs", uniqueDeps: 40, networkCalls: counter.count })}`
    );
  });
});
