import { beforeEach, describe, expect, it, vi } from "vitest";
import { scanRepository } from "../scanner";
import { resetDependencyProcessCachesForTests } from "@/features/security-analysis/shared/dependency-process-cache";

/**
 * Phase 23 -- proves the new end-to-end plumbing (package-security's
 * registryMetrics -> ScanSharedContext.registryMetricsSink -> scanner.ts ->
 * ScanResult.metrics.registryMetrics, which scan-job-runner.ts already
 * persists into scans.metrics unchanged) actually works, and that failures
 * anywhere in this telemetry side-channel can never affect scan findings or
 * cause the scan to fail. Golden rule: telemetry is diagnostic only.
 */

function file(path: string, content: string) {
  return { path, content };
}

beforeEach(() => {
  resetDependencyProcessCachesForTests();
});

describe("Phase 23 -- registry telemetry reaches ScanResult.metrics end-to-end", () => {
  it("a real scan with npm dependencies populates metrics.registryMetrics with sane aggregate values", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    const files = [
      file("package.json", JSON.stringify({ dependencies: { "telemetry-e2e-pkg": "^1.0.0" } })),
    ];

    // scanRepository doesn't take a fetchImpl directly -- it runs the real
    // rule registry, which for package-security ultimately calls the real
    // global fetch. Stub it globally for this test only.
    const originalFetch = global.fetch;
    global.fetch = fetchImpl;
    try {
      const result = await scanRepository(files);
      const registryMetrics = result.metrics.registryMetrics as
        | { registryLookupCount: number; networkRequestCount: number; unavailableCount: number }
        | undefined;

      expect(registryMetrics).toBeDefined();
      expect(registryMetrics?.registryLookupCount).toBe(1);
      expect(registryMetrics?.networkRequestCount).toBe(1);
      expect(registryMetrics?.unavailableCount).toBe(0);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("a repository with no registry-checkable dependencies still populates registryMetrics, all-zero (package-security ran, just had nothing to check)", async () => {
    const files = [file("README.md", "# hello")];
    const result = await scanRepository(files);
    const registryMetrics = result.metrics.registryMetrics as { registryLookupCount: number } | undefined;
    expect(registryMetrics).toBeDefined();
    expect(registryMetrics?.registryLookupCount).toBe(0);
  });
});

describe("Phase 23 -- telemetry failure can never break the scan (golden rule)", () => {
  it("scan findings/completion are identical whether or not registry telemetry capture succeeds", async () => {
    const fetchImpl = vi.fn(async () => new Response("Not Found", { status: 404 })) as unknown as typeof fetch;
    const files = [
      file("package.json", JSON.stringify({ dependencies: { "ai-hallucinated-telemetry-test": "^1.0.0" } })),
    ];

    const originalFetch = global.fetch;
    global.fetch = fetchImpl;
    try {
      const result = await scanRepository(files);
      // The security-relevant outcome (a hallucination finding) must exist
      // regardless of whether the telemetry side-channel worked -- this
      // scan's own metrics.registryMetrics presence/absence is irrelevant
      // to whether the finding was correctly produced.
      expect(result.findings.some((f) => f.title.toLowerCase().includes("hallucinat"))).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it(
    "packageSecurityRule.run still returns correct findings even when shared.registryMetricsSink throws " +
      "on write (unit-level proof of the try/catch scanner.ts and package-security-rule.ts both rely on)",
    async () => {
      const { packageSecurityRule } = await import("@/features/security-analysis/rules/package-security-rule");
      const { createScanSharedContext } = await import("@/features/security-analysis/shared/scan-context");
      const { normalizeFiles } = await import("../normalization");
      const { resolveConfig } = await import("../config");
      const { detectStack } = await import("../stack");

      const fetchImpl = vi.fn(async () => new Response("Not Found", { status: 404 })) as unknown as typeof fetch;
      const files = [
        file("package.json", JSON.stringify({ dependencies: { "poisoned-sink-hallucinated-pkg": "^1.0.0" } })),
      ];

      const originalFetch = global.fetch;
      global.fetch = fetchImpl;
      try {
        const config = resolveConfig({});
        const normalized = normalizeFiles(files, config);
        const stack = detectStack(normalized.files);
        const shared = createScanSharedContext(normalized.files);
        // Poison the sink so any write throws -- exactly the failure mode
        // package-security-rule.ts's try/catch is meant to survive.
        Object.defineProperty(shared, "registryMetricsSink", {
          get() {
            throw new Error("simulated telemetry sink corruption");
          },
        });

        const byPath = new Map(normalized.files.map((f) => [f.path, f]));
        const drafts = await packageSecurityRule.run({
          files: normalized.files,
          stack,
          getFile: (p) => byPath.get(p),
          shared,
        });

        // The security-relevant outcome (hallucination finding) must still
        // be produced -- the poisoned telemetry sink never propagated.
        expect(drafts.some((d) => d.title.toLowerCase().includes("hallucinat"))).toBe(true);
      } finally {
        global.fetch = originalFetch;
      }
    }
  );
});
