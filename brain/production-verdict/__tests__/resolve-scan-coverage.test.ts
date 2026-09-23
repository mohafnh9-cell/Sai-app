import { describe, expect, it } from "vitest";
import { resolveScanCoverageForVerdict } from "@/brain/production-verdict/resolve-scan-coverage";

describe("resolveScanCoverageForVerdict", () => {
  it("keeps current coverage when already sufficient", () => {
    expect(
      resolveScanCoverageForVerdict({
        filesAnalyzed: 42,
        filesDiscovered: 50,
        priorScan: { filesAnalyzed: 10, filesDiscovered: 12 },
      })
    ).toEqual({
      filesAnalyzed: 42,
      filesDiscovered: 50,
      inheritedFromPrior: false,
    });
  });

  it("inherits prior coverage for empty incremental scans", () => {
    expect(
      resolveScanCoverageForVerdict({
        filesAnalyzed: 0,
        filesDiscovered: 0,
        priorScan: { filesAnalyzed: 50, filesDiscovered: 60 },
      })
    ).toEqual({
      filesAnalyzed: 50,
      filesDiscovered: 60,
      inheritedFromPrior: true,
    });
  });

  it("never counts merely discovered files as analyzed", () => {
    // A scan that analyzed nothing has not analyzed the repository, however
    // many files it saw. Treating discovered as analyzed fabricated coverage.
    expect(
      resolveScanCoverageForVerdict({
        filesAnalyzed: 0,
        filesDiscovered: 8,
      })
    ).toEqual({
      filesAnalyzed: 0,
      filesDiscovered: 8,
      inheritedFromPrior: false,
    });
  });

  it("does not borrow a prior scan's coverage when the caller supplies none (full scans)", () => {
    expect(
      resolveScanCoverageForVerdict({
        filesAnalyzed: 1,
        filesDiscovered: 400,
        priorScan: null,
      })
    ).toEqual({
      filesAnalyzed: 1,
      filesDiscovered: 400,
      inheritedFromPrior: false,
    });
  });
});
