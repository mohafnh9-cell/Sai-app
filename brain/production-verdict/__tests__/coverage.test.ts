import { describe, expect, it } from "vitest";
import { assessCoverage, hasSufficientCoverage } from "@/brain/production-verdict/coverage";
import { generateProductionVerdict } from "@/brain/production-verdict/engine";
import { VERDICT_THRESHOLDS } from "@/brain/production-verdict/config";

// SECURITY regression (Phase Z v2 Pass 3, CRIT-001): `filesAnalyzed >= 3 →
// return true` previously made the coverageRatio floor permanently
// unreachable in hasSufficientCoverage, letting a scan of just a handful
// of files register as "sufficient coverage" for an arbitrarily large
// repository. These tests lock in the restored, reachable two-part gate.
describe("hasSufficientCoverage", () => {
  it("rejects a completed scan below the minimum files-analyzed floor", () => {
    expect(
      hasSufficientCoverage({ filesAnalyzed: 2, coverageRatio: 1, scanStatus: "completed" })
    ).toBe(false);
  });

  it("rejects a completed scan whose coverageRatio is below the minimum, even with enough files analyzed", () => {
    expect(
      hasSufficientCoverage({
        filesAnalyzed: 50,
        coverageRatio: 0.05,
        scanStatus: "completed",
      })
    ).toBe(false);
  });

  it("accepts a small repository fully analyzed (high ratio, low absolute file count)", () => {
    expect(
      hasSufficientCoverage({ filesAnalyzed: 5, coverageRatio: 1, scanStatus: "completed" })
    ).toBe(true);
  });

  it("accepts a large repository with a ratio at or above the configured floor", () => {
    expect(
      hasSufficientCoverage({
        filesAnalyzed: 300,
        coverageRatio: VERDICT_THRESHOLDS.minCoverageRatio,
        scanStatus: "completed",
      })
    ).toBe(true);
  });

  it("treats a missing coverageRatio (legacy scans) as non-blocking, gated only by files-analyzed floor", () => {
    expect(
      hasSufficientCoverage({ filesAnalyzed: 10, coverageRatio: null, scanStatus: "completed" })
    ).toBe(true);
  });

  it("always rejects a failed scan regardless of coverage", () => {
    expect(
      hasSufficientCoverage({ filesAnalyzed: 500, coverageRatio: 1, scanStatus: "failed" })
    ).toBe(false);
  });
});

describe("assessCoverage coverageRatio", () => {
  it("computes the true files-analyzed/files-discovered fraction when filesDiscovered is known", () => {
    const result = assessCoverage({ findings: [], securityScore: 100, filesAnalyzed: 3, filesDiscovered: 3000 });
    expect(result.coverageRatio).toBeCloseTo(0.001, 5);
  });

  it("gives a small, fully-analyzed repository full credit regardless of absolute file count", () => {
    const result = assessCoverage({ findings: [], securityScore: 100, filesAnalyzed: 4, filesDiscovered: 4 });
    expect(result.coverageRatio).toBe(1);
  });

  it("falls back to the legacy heuristic when filesDiscovered is unknown", () => {
    const result = assessCoverage({ findings: [], securityScore: 100, filesAnalyzed: 50 });
    expect(result.coverageRatio).not.toBeNull();
  });
});

function baseVerdictInput(overrides: Partial<Parameters<typeof generateProductionVerdict>[0]> = {}) {
  return {
    projectId: "11111111-1111-4111-8111-111111111111",
    repositoryId: "11111111-1111-4111-8111-111111111111",
    scanId: "22222222-2222-4222-8222-222222222222",
    scanStatus: "completed",
    securityScore: 92,
    filesAnalyzed: 3,
    findings: [] as never[],
    ...overrides,
  };
}

describe("generateProductionVerdict — CRIT-001 coverage-floor regression", () => {
  // A: 3 files / tiny coverage / zero findings -> not ready
  it("A: a 3-file scan of a large repository with zero findings is not ready_to_ship", () => {
    const { verdict } = generateProductionVerdict(
      baseVerdictInput({ filesAnalyzed: 3, filesDiscovered: 5000, securityScore: 92, findings: [] })
    );
    expect(verdict.status).not.toBe("ready_to_ship");
    expect(verdict.status).toBe("insufficient_data");
  });

  // B: small repository / genuinely complete coverage -> normal canonical verdict
  it("B: a small repository analyzed in full resolves a normal canonical verdict, not insufficient_data", () => {
    const { verdict } = generateProductionVerdict(
      baseVerdictInput({ filesAnalyzed: 5, filesDiscovered: 5, securityScore: 92, findings: [] })
    );
    expect(verdict.status).not.toBe("insufficient_data");
    expect(verdict.status).toBe("ready_to_ship");
  });

  // C: large repository / tiny analyzed subset -> not ready
  it("C: a large repository with only a tiny analyzed subset is not ready_to_ship", () => {
    const { verdict } = generateProductionVerdict(
      baseVerdictInput({ filesAnalyzed: 10, filesDiscovered: 10000, securityScore: 95, findings: [] })
    );
    expect(verdict.status).toBe("insufficient_data");
  });

  // D: high score + low coverage -> not ready
  it("D: a high security score cannot override insufficient coverage", () => {
    const { verdict } = generateProductionVerdict(
      baseVerdictInput({ filesAnalyzed: 3, filesDiscovered: 2000, securityScore: 100, findings: [] })
    );
    expect(verdict.status).toBe("insufficient_data");
    expect(verdict.status).not.toBe("ready_to_ship");
  });

  // E: zero findings + insufficient coverage -> not ready
  it("E: zero findings does not compensate for insufficient coverage", () => {
    const { verdict } = generateProductionVerdict(
      baseVerdictInput({ filesAnalyzed: 3, filesDiscovered: 1000, securityScore: 100, findings: [] })
    );
    expect(verdict.status).toBe("insufficient_data");
    expect(verdict.blockersCount).toBe(0);
  });

  // F: coverage decreases while all other evidence stays equal -> confidence must not increase
  it("F: decreasing coverage (same score/findings) never produces a stronger status or confidence", () => {
    const highCoverage = generateProductionVerdict(
      baseVerdictInput({ filesAnalyzed: 300, filesDiscovered: 300, securityScore: 92, findings: [] })
    ).verdict;
    const lowCoverage = generateProductionVerdict(
      baseVerdictInput({ filesAnalyzed: 3, filesDiscovered: 300, securityScore: 92, findings: [] })
    ).verdict;

    const statusRank: Record<string, number> = {
      analysis_failed: 0,
      insufficient_data: 1,
      not_ready: 2,
      needs_improvement: 3,
      almost_ready: 4,
      ready_to_ship: 5,
    };
    expect(statusRank[lowCoverage.status]).toBeLessThanOrEqual(statusRank[highCoverage.status]);
    expect(lowCoverage.status).toBe("insufficient_data");

    const confidenceRank: Record<string, number> = { low: 0, medium: 1, high: 2 };
    expect(confidenceRank[lowCoverage.confidence]).toBeLessThanOrEqual(
      confidenceRank[highCoverage.confidence]
    );
  });

  it("overallConfidence is always low when status is insufficient_data (no decision-facing disagreement)", () => {
    const { verdict } = generateProductionVerdict(
      baseVerdictInput({ filesAnalyzed: 3, filesDiscovered: 5000, securityScore: 100, findings: [] })
    );
    expect(verdict.status).toBe("insufficient_data");
    expect(verdict.confidence).toBe("low");
  });
});
