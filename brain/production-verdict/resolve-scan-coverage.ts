export type ScanCoverageSnapshot = {
  filesAnalyzed: number;
  filesDiscovered: number;
};

/**
 * Resolves the coverage a verdict may claim for a scan.
 *
 * `priorScan` must only be supplied for incremental scans (which legitimately
 * analyze just the changed files). A full scan that analyzed almost nothing
 * has not analyzed the repository, and borrowing a previous scan's coverage
 * would present historical evidence as this scan's. Files that were merely
 * discovered are never counted as analyzed.
 */
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

  return { filesAnalyzed, filesDiscovered: Math.max(filesDiscovered, filesAnalyzed), inheritedFromPrior: false };
}
