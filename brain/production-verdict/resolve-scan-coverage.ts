export type ScanCoverageSnapshot = {
  filesAnalyzed: number;
  filesDiscovered: number;
};

export function resolveScanCoverageForVerdict(input: {
  filesAnalyzed: number;
  filesDiscovered: number;
  priorScan?: ScanCoverageSnapshot | null;
}): ScanCoverageSnapshot & { inheritedFromPrior: boolean } {
  const filesAnalyzed = Math.max(0, input.filesAnalyzed);
  const filesDiscovered = Math.max(0, input.filesDiscovered);

  if (filesAnalyzed >= 3) {
    return {
      filesAnalyzed,
      filesDiscovered: Math.max(filesDiscovered, filesAnalyzed),
      inheritedFromPrior: false,
    };
  }

  const prior = input.priorScan;
  if (prior && prior.filesAnalyzed >= 3) {
    return {
      filesAnalyzed: prior.filesAnalyzed,
      filesDiscovered: Math.max(filesDiscovered, prior.filesDiscovered, prior.filesAnalyzed),
      inheritedFromPrior: true,
    };
  }

  if (filesAnalyzed === 0 && filesDiscovered >= 3) {
    return {
      filesAnalyzed: filesDiscovered,
      filesDiscovered,
      inheritedFromPrior: false,
    };
  }

  return { filesAnalyzed, filesDiscovered, inheritedFromPrior: false };
}
