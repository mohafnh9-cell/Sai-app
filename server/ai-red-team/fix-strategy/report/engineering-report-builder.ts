import type {
  AttackCampaign,
  EngineeringReport,
  GroupedFix,
  RootCause,
  EffortComplexity,
} from "../fix-strategy.types";

export function buildEngineeringReport(input: {
  campaign: AttackCampaign;
  rootCauses: RootCause[];
  groupedFixes: GroupedFix[];
  filesAffected: string[];
  remainingRisks: string[];
}): EngineeringReport {
  const totalHours = input.groupedFixes.reduce(
    (sum, f) => sum + (f.strategies.find((s) => s.variant === f.recommendedVariant)?.engineeringTimeHours ?? 4),
    0
  );
  const estimatedEffort: EffortComplexity =
    totalHours <= 8 ? "low" : totalHours <= 24 ? "medium" : "high";

  return {
    executiveSummary: `${input.groupedFixes.length} grouped fixes address ${input.rootCauses.length} root causes for campaign "${input.campaign.goal}".`,
    attackSummary: input.campaign.steps.map((s) => s.label).join(" → "),
    rootCauses: input.rootCauses.map((c) => c.title),
    fixStrategySummary: input.groupedFixes.map((f) => f.title).join("; "),
    tradeoffs: input.groupedFixes.flatMap((f) => f.strategies[1]?.tradeoffs ?? []).slice(0, 5),
    estimatedEffort,
    architectureImpact:
      input.groupedFixes.some((f) => f.recommendedVariant === "architecture_refactor")
        ? "Moderate — prefer production_fix unless blockers remain after replay."
        : "Low — incremental middleware and policy changes.",
    filesAffected: input.filesAffected,
    testingPlan: [
      "Run new regression specs from Fix Strategy Engine.",
      "Execute authorized replay; failures block production readiness.",
    ],
    deploymentImpact: "Deploy only after replay passes; no production-ready flag from prompts alone.",
    remainingRisks: input.remainingRisks,
  };
}
