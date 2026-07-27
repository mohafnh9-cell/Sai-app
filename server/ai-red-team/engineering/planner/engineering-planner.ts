import type {
  ArchitectureChange,
  EngineeringStrategyOption,
  EngineeringStrategyVariant,
  ImplementationStep,
  PlanRootCause,
  UniversalEngineeringPlan,
} from "../uee.types";
import type { GroupedFix, RootCause } from "../../fix-strategy/fix-strategy.types";
import type { AttackCampaign } from "../../fix-strategy/fix-strategy.types";
import type { DiscoveryReport } from "../../discovery/types";
import type { RegressionTestSpec } from "../../fix-strategy/fix-strategy.types";

export type PlannerInput = {
  campaign: AttackCampaign;
  rootCauses: RootCause[];
  groupedFixes: GroupedFix[];
  discovery: DiscoveryReport;
  architectureNotes: string[];
  preserveRules: string[];
  regressionTests: RegressionTestSpec[];
  replayPlanIds: string[];
  replayStatus: "not_run" | "passed" | "failed";
  planVersion: number;
  planId: string;
};

function toPlanRootCauses(causes: RootCause[]): PlanRootCause[] {
  return causes.map((c, index) => ({
    id: c.rootCauseId,
    title: c.title,
    description: c.description,
    kind: c.kind,
    primary: index === 0,
    findingIds: c.findingIds,
    sharedCauseIds: c.sharedWith,
  }));
}

function buildStrategies(groupedFixes: GroupedFix[]): EngineeringStrategyOption[] {
  const sample = groupedFixes[0]?.strategies ?? [];
  return sample.map((s) => ({
    variant: s.variant as EngineeringStrategyVariant,
    title: s.title,
    advantages: s.advantages,
    tradeoffs: s.tradeoffs,
    risk: s.risk,
    engineeringCost: s.estimatedEffort,
    estimatedHours: s.engineeringTimeHours,
    confidence: s.confidence,
  }));
}

export function buildUniversalEngineeringPlan(input: PlannerInput): UniversalEngineeringPlan {
  const affectedFiles = [...new Set(input.groupedFixes.flatMap((f) => f.likelyFiles))];
  const affectedComponents = input.groupedFixes.map((f) => f.title);
  const selectedStrategy =
    input.groupedFixes[0]?.recommendedVariant ?? ("production_fix" as EngineeringStrategyVariant);

  const implementationOrder: ImplementationStep[] = input.groupedFixes
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .map((fix) => ({
      stepId: fix.fixId,
      title: fix.title,
      why: fix.summary,
      impact: fix.findingIds.length > 3 ? "high" : "medium",
      affectedFiles: fix.likelyFiles,
    }));

  const architectureChanges: ArchitectureChange[] = input.groupedFixes.map((fix) => ({
    changeId: fix.fixId,
    title: fix.title,
    rationale: fix.summary,
    impact: fix.rootCauseId.includes("architectural") ? "high" : "medium",
  }));

  const totalHours = input.groupedFixes.reduce(
    (sum, f) => sum + (f.strategies.find((s) => s.variant === f.recommendedVariant)?.engineeringTimeHours ?? 4),
    0
  );
  const estimatedComplexity: UniversalEngineeringPlan["estimatedComplexity"] =
    totalHours <= 8 ? "low" : totalHours <= 24 ? "medium" : "high";

  const remainingRisks =
    input.replayStatus === "failed"
      ? ["Replay still succeeds — vulnerability not eliminated.", "Generate revised plan before deploy."]
      : input.replayStatus === "not_run"
        ? ["Replay not executed — production verdict unchanged."]
        : ["Validate adjacent routes after deployment."];

  return {
    planId: input.planId,
    version: input.planVersion,
    summary: `Remediate ${input.campaign.goal} with ${input.groupedFixes.length} engineering change groups addressing ${input.rootCauses.length} root causes.`,
    objectives: [
      "Eliminate confirmed attack paths with minimal, maintainable changes.",
      "Preserve public APIs and existing business behavior unless unsafe.",
      "Prove remediation via authorized replay before production promotion.",
    ],
    attackSummary: input.campaign.steps.map((s) => s.label).join(" → "),
    rootCauses: toPlanRootCauses(input.rootCauses),
    architectureChanges,
    implementationOrder,
    affectedComponents,
    affectedFiles,
    securityImprovements: input.groupedFixes.map((f) => f.summary),
    constraints: [
      ...input.preserveRules,
      "Minimize diff size; avoid unrelated refactors.",
      "Do not remove security controls without equivalent replacement.",
      "No production data in tests; use synthetic identities only.",
    ],
    requiredTests: input.regressionTests.map((t) => `${t.level}: ${t.title}`),
    regressionTests: input.regressionTests.map((t) => ({
      id: t.id,
      domain: t.domain,
      level: t.level,
      title: t.title,
      description: t.description,
    })),
    verificationSteps: [
      "Confirm each implementation step satisfies its root cause.",
      "Run regression and security tests.",
      "Execute authorized replay — exploited paths must fail.",
    ],
    rollbackPlan: [
      "Revert commit if replay fails or critical regression detected.",
      "Restore previous middleware/policy configuration from version control.",
    ],
    deploymentNotes: [
      "Deploy only after replay passes.",
      "Engineering plan alone does not mark vulnerabilities fixed.",
    ],
    remainingRisks,
    estimatedComplexity,
    estimatedEngineeringHours: totalHours,
    confidenceScore: Math.min(0.95, 0.55 + input.rootCauses.length * 0.08),
    blastRadius: input.groupedFixes.length > 3 ? "medium" : "low",
    rollbackRisk: selectedStrategy === "architecture_refactor" ? "high" : "low",
    definitionOfDone: [
      "All implementation steps complete",
      "New and existing tests pass",
      "Replay validation passed",
      "Remaining risks documented",
    ],
    strategies: buildStrategies(input.groupedFixes),
    selectedStrategy,
    replay: {
      mandatory: true,
      replayPlanIds: input.replayPlanIds,
      status: input.replayStatus,
      productionVerdictGate: true,
    },
    campaign: {
      campaignId: input.campaign.campaignId,
      goal: input.campaign.goal,
      severity: input.campaign.severity,
    },
  };
}
