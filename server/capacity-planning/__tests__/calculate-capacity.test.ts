import { describe, expect, it } from "vitest";
import {
  REQUIRES_ACCOUNT_VERIFICATION,
  REALISTIC_MIX,
  WORST_CASE_LARGE,
  WORST_CASE_EXTREME,
  calculateCapacity,
  weightedAverageDependencies,
  type CapacityInputs,
} from "../calculate-capacity";

/**
 * Phase 26 -- tests for the deterministic 1,000-scan capacity calculator.
 * Pure-function tests only, no DB/network involved.
 */

// MODELED workload shape, drawn from real measurements (Phases 14.1, 21-24):
// blended average scan duration for a realistic size mix, and this
// workload's proven DB-op-per-scan count.
const BASE_INPUTS: Omit<CapacityInputs, "organizationCount" | "vercelInstanceCount"> = {
  vercelMaxConcurrentExecutions: REQUIRES_ACCOUNT_VERIFICATION,
  inngestGlobalConcurrency: REQUIRES_ACCOUNT_VERIFICATION,
  supabaseCapacityOpsPerSec: REQUIRES_ACCOUNT_VERIFICATION,
  averageScanDurationMs: 6_000,
  p95ScanDurationMs: 15_000,
  averageDbOpsPerScan: 17,
  averageDependencies: 150,
  averageRegistryLatencyMs: 150,
};

describe("Phase 26 -- capacity calculator: unknown inputs never silently become a number", () => {
  it("with all three critical account inputs unverified, maxActiveScans is the sentinel, not 0 or Infinity", () => {
    const result = calculateCapacity(
      { ...BASE_INPUTS, organizationCount: 10, vercelInstanceCount: REQUIRES_ACCOUNT_VERIFICATION },
      1000
    );
    expect(result.maxActiveScans).toBe(REQUIRES_ACCOUNT_VERIFICATION);
    expect(result.unverifiedInputs).toEqual(
      expect.arrayContaining(["vercelMaxConcurrentExecutions", "inngestGlobalConcurrency", "supabaseCapacityOpsPerSec", "vercelInstanceCount"])
    );
    // Even when the headline number is unverified, the known-limits partial
    // answer must still be a real, useful number.
    expect(typeof result.maxActiveScansFromKnownLimits).toBe("number");
    expect(result.maxActiveScansFromKnownLimits).toBeGreaterThan(0);
  });

  it("registry fleet-wide pressure is the sentinel when vercelInstanceCount is unverified, not 0", () => {
    const result = calculateCapacity(
      { ...BASE_INPUTS, organizationCount: 400, vercelInstanceCount: REQUIRES_ACCOUNT_VERIFICATION },
      1000
    );
    expect(result.registryPressure.peakFleetWide).toBe(REQUIRES_ACCOUNT_VERIFICATION);
  });

  it("safetyMarginPct is the sentinel when account limits are unverified", () => {
    const result = calculateCapacity(
      { ...BASE_INPUTS, organizationCount: 400, vercelInstanceCount: 50 },
      1000
    );
    expect(result.safetyMarginPct).toBe(REQUIRES_ACCOUNT_VERIFICATION);
  });

  it("once all three critical account inputs are provided, maxActiveScans becomes a real number", () => {
    const result = calculateCapacity(
      {
        ...BASE_INPUTS,
        vercelMaxConcurrentExecutions: 2000,
        inngestGlobalConcurrency: 2000,
        supabaseCapacityOpsPerSec: 5000,
        organizationCount: 400,
        vercelInstanceCount: 50,
      },
      1000
    );
    expect(typeof result.maxActiveScans).toBe("number");
    expect(result.unverifiedInputs).toEqual([]);
  });
});

describe("Phase 26 -- Inngest per-organization constraint (proven value = 3)", () => {
  it.each([10, 50, 100, 250, 334, 500, 667, 1000])(
    "%i organizations: max simultaneous scans under the per-org=3 limit is orgs x 3",
    (orgs) => {
      const result = calculateCapacity({ ...BASE_INPUTS, organizationCount: orgs, vercelInstanceCount: 50 }, 1000);
      // inngest_per_org limit should equal orgs * 3 and be reflected either
      // as the bottleneck or at least present in the known-limits computation.
      const expectedPerOrgLimit = orgs * 3;
      if (result.firstBottleneck === "inngest_per_org") {
        expect(result.maxActiveScansFromKnownLimits).toBe(expectedPerOrgLimit);
      } else {
        // Some other known limit was lower -- the per-org limit itself must
        // still be at least as large as whatever won, never silently ignored.
        expect(result.maxActiveScansFromKnownLimits).toBeLessThanOrEqual(expectedPerOrgLimit);
      }
    }
  );

  it("334 organizations is exactly the documented minimum for 1,000 active scans at the current per-org=3 limit", () => {
    const result = calculateCapacity({ ...BASE_INPUTS, organizationCount: 334, vercelInstanceCount: 100 }, 1000);
    expect(result.requiredOrganizations).toBe(334);
    expect(334 * 3).toBeGreaterThanOrEqual(1000);
    expect(333 * 3).toBeLessThan(1000);
  });

  it("does NOT recommend removing the per-org limit -- it remains a hard input, never bypassed even with huge account limits", () => {
    const result = calculateCapacity(
      {
        ...BASE_INPUTS,
        vercelMaxConcurrentExecutions: 100_000,
        inngestGlobalConcurrency: 100_000,
        supabaseCapacityOpsPerSec: 1_000_000,
        organizationCount: 10, // only 10 orgs -- per-org=3 caps this at 30 regardless of huge account limits
        vercelInstanceCount: 1000,
      },
      1000
    );
    expect(result.maxActiveScans).toBe(30);
    expect(result.firstBottleneck).toBe("inngest_per_org");
  });
});

describe("Phase 26 -- registry pressure model", () => {
  it("theoretical pressure scales with target scan count and average dependency count, no real requests sent", () => {
    const result100 = calculateCapacity({ ...BASE_INPUTS, organizationCount: 50, vercelInstanceCount: 20 }, 100);
    const result1000 = calculateCapacity({ ...BASE_INPUTS, organizationCount: 400, vercelInstanceCount: 20 }, 1000);
    expect(result1000.registryPressure.theoreticalRequestsNoOverlap).toBe(
      result100.registryPressure.theoreticalRequestsNoOverlap * 10
    );
  });

  it("peak per instance is always the proven 32, regardless of scenario", () => {
    const result = calculateCapacity({ ...BASE_INPUTS, organizationCount: 400, vercelInstanceCount: 20 }, 1000);
    expect(result.registryPressure.peakPerInstance).toBe(32);
  });

  it.each([1, 5, 10, 25, 50, 100])("fleet-wide pressure at %i instances = instances x 32", (instances) => {
    const result = calculateCapacity(
      { ...BASE_INPUTS, organizationCount: 400, vercelInstanceCount: instances },
      1000
    );
    expect(result.registryPressure.peakFleetWide).toBe(instances * 32);
  });
});

describe("Phase 26 -- worst-case repository mix must not be hidden behind averages", () => {
  it("100% EXTREME mix produces a materially higher registry-pressure estimate than the realistic mix", () => {
    const realistic = calculateCapacity(
      { ...BASE_INPUTS, organizationCount: 400, vercelInstanceCount: 20 },
      1000,
      REALISTIC_MIX
    );
    const worstCase = calculateCapacity(
      { ...BASE_INPUTS, organizationCount: 400, vercelInstanceCount: 20 },
      1000,
      WORST_CASE_EXTREME
    );
    expect(worstCase.registryPressure.theoreticalRequestsNoOverlap).toBeGreaterThan(
      realistic.registryPressure.theoreticalRequestsNoOverlap
    );
  });

  it("100% LARGE worst case still computes a real, non-zero, non-crashing result", () => {
    const result = calculateCapacity(
      { ...BASE_INPUTS, organizationCount: 400, vercelInstanceCount: 20 },
      1000,
      WORST_CASE_LARGE
    );
    expect(result.registryPressure.theoreticalRequestsNoOverlap).toBeGreaterThan(0);
  });

  it("weightedAverageDependencies is a real, deterministic function of the mix", () => {
    expect(weightedAverageDependencies(WORST_CASE_EXTREME)).toBe(909);
    expect(weightedAverageDependencies(WORST_CASE_LARGE)).toBe(300);
    expect(weightedAverageDependencies(REALISTIC_MIX)).toBeGreaterThan(0);
    expect(weightedAverageDependencies(REALISTIC_MIX)).toBeLessThan(weightedAverageDependencies(WORST_CASE_EXTREME));
  });
});

describe("Phase 26 -- p95 vs average duration are both modeled, never conflated", () => {
  it("p95 completion time is always >= average completion time for the same scenario", () => {
    const result = calculateCapacity({ ...BASE_INPUTS, organizationCount: 400, vercelInstanceCount: 50 }, 1000);
    expect(result.completionTimeForTargetMs.p95).toBeGreaterThanOrEqual(result.completionTimeForTargetMs.average);
  });

  it("p95 throughput is always <= average throughput for the same scenario (slower duration -> lower throughput)", () => {
    const result = calculateCapacity({ ...BASE_INPUTS, organizationCount: 400, vercelInstanceCount: 50 }, 1000);
    expect(result.throughputPerMinute.p95).toBeLessThanOrEqual(result.throughputPerMinute.average);
  });
});

describe("Phase 26 -- scenario sweep (10/25/100/250/500/1000/2000)", () => {
  it.each([10, 25, 100, 250, 500, 1000, 2000])(
    "target=%i: calculator produces a complete, internally consistent result with sufficient orgs/instances",
    (target) => {
      const orgs = Math.ceil(target / 3) + 10;
      const result = calculateCapacity({ ...BASE_INPUTS, organizationCount: orgs, vercelInstanceCount: 200 }, target);
      expect(result.targetActiveScans).toBe(target);
      expect(result.requiredOrganizations).toBe(Math.ceil(target / 3));
      expect(result.dbPressure.opsPerMinute).toBeGreaterThan(0);
      expect(result.registryPressure.theoreticalRequestsNoOverlap).toBeGreaterThan(0);
      expect(result.workerRequirement.requiredExecutionSlots).toBeGreaterThan(0);
      expect(result.workerRequirement.requiredExecutionSlots).toBeLessThanOrEqual(target);
    }
  );
});

describe("Phase 26 -- DB pressure model", () => {
  it("DB ops/minute scales with effective concurrency and the proven ~17 ops/scan figure", () => {
    const result = calculateCapacity({ ...BASE_INPUTS, organizationCount: 400, vercelInstanceCount: 200 }, 100);
    expect(result.dbPressure.opsPerSecond).toBeGreaterThan(0);
    expect(result.dbPressure.opsPerMinute).toBeCloseTo(result.dbPressure.opsPerSecond * 60, -1);
  });
});
