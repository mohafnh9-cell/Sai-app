export type CoreCoverageSlice = {
  present: boolean;
  count: number;
  coveragePercent: number;
};

export type CoreCoverageReport = {
  overallPercent: number;
  slices: Record<string, CoreCoverageSlice>;
  notes: string[];
};

export type CoreCoverageAnalysisContract = {
  analyze(input: Record<string, number>): CoreCoverageReport;
};

export function computeStepCoverage(steps: boolean[]): number {
  if (steps.length === 0) return 0;
  const done = steps.filter(Boolean).length;
  return Math.round((done / steps.length) * 100);
}
