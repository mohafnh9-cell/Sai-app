import type { GroupedFix, SafeFixScore } from "../fix-strategy.types";

export function scoreFixStrategy(input: {
  groupedFixes: GroupedFix[];
  findingCount: number;
  backwardCompatible: boolean;
}): SafeFixScore {
  const fixes = input.groupedFixes.length || 1;
  const compression = input.findingCount > 0 ? Math.min(1, fixes / input.findingCount) : 0.5;
  const securityImprovement = Math.min(100, 40 + input.findingCount * 2 + fixes * 5);
  const maintainability = Math.round(50 + compression * 40);
  const architecture = Math.round(input.groupedFixes.some((f) => f.recommendedVariant === "architecture_refactor") ? 55 : 75);
  const backwardCompatibility = input.backwardCompatible ? 90 : 60;
  const technicalDebtReduction = Math.round(45 + compression * 35);
  const overallQuality = Math.round(
    (securityImprovement +
      maintainability +
      architecture +
      backwardCompatibility +
      technicalDebtReduction) /
      5
  );

  return {
    securityImprovement,
    maintainability,
    architecture,
    backwardCompatibility,
    technicalDebtReduction,
    overallQuality,
  };
}
