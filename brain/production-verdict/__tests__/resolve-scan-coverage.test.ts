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

  it("uses discovered files when no prior scan exists", () => {
    expect(
      resolveScanCoverageForVerdict({
        filesAnalyzed: 0,
        filesDiscovered: 8,
      })
    ).toEqual({
      filesAnalyzed: 8,
      filesDiscovered: 8,
      inheritedFromPrior: false,
    });
  });
});
