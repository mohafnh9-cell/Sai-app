import type { GroupedFix, RootCause, FixStrategyOption, FixStrategyVariant } from "../fix-strategy.types";
import type { AttackFinding } from "../../types";
import type { PrioritizedRemediation } from "../../intelligence/models";

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 100,
  high: 70,
  medium: 40,
  low: 15,
  info: 5,
};

function strategyOptions(rootCauseId: string): FixStrategyOption[] {
  const base: Record<string, Partial<FixStrategyOption>> = {
    "rc.authorization_boundary": {
      title: "Centralize authorization middleware",
      advantages: ["One enforcement point", "Fixes tenant, ownership, and admin gaps together"],
      tradeoffs: ["Requires touching multiple routes once"],
      estimatedEffort: "medium",
      engineeringTimeHours: 8,
      risk: "low",
      rollbackRisk: "low",
      confidence: 0.85,
    },
    "rc.session_auth": {
      title: "Harden session and token lifecycle",
      advantages: ["Reduces replay and session fixation risk"],
      tradeoffs: ["May require client cookie changes"],
      estimatedEffort: "medium",
      engineeringTimeHours: 6,
      risk: "medium",
      rollbackRisk: "medium",
      confidence: 0.8,
    },
    "rc.llm_controls": {
      title: "Add LLM guardrails and output filtering",
      advantages: ["Blocks prompt injection chains"],
      tradeoffs: ["Latency and false positives"],
      estimatedEffort: "medium",
      engineeringTimeHours: 10,
      risk: "low",
      rollbackRisk: "low",
      confidence: 0.75,
    },
  };

  const production = base[rootCauseId] ?? {
    title: "Targeted production fix",
    advantages: ["Minimal scope", "Preserves APIs"],
    tradeoffs: ["May not address adjacent weaknesses"],
    estimatedEffort: "low" as const,
    engineeringTimeHours: 4,
    risk: "low" as const,
    rollbackRisk: "low" as const,
    confidence: 0.7,
  };

  const variants: FixStrategyVariant[] = ["quick_fix", "production_fix", "best_practice", "architecture_refactor"];
  return variants.map((variant, index) => ({
    variant,
    title: `${production.title} (${variant.replace(/_/g, " ")})`,
    advantages: production.advantages ?? ["Addresses root cause"],
    tradeoffs: production.tradeoffs ?? ["Engineering time required"],
    estimatedEffort:
      variant === "quick_fix"
        ? "low"
        : variant === "architecture_refactor"
          ? "high"
          : (production.estimatedEffort ?? "medium"),
    engineeringTimeHours: (production.engineeringTimeHours ?? 4) + index * 2,
    risk: variant === "quick_fix" ? "medium" : (production.risk ?? "low"),
    rollbackRisk: variant === "architecture_refactor" ? "high" : (production.rollbackRisk ?? "low"),
    confidence: Math.max(0.5, (production.confidence ?? 0.7) - index * 0.05),
  }));
}

function likelyFilesForCause(rootCauseId: string, discoverySummary: string): string[] {
  const files: string[] = [];
  if (rootCauseId === "rc.authorization_boundary") {
    files.push("middleware.ts", "server/**/authorization/**", "lib/auth/**");
  }
  if (rootCauseId === "rc.session_auth") {
    files.push("lib/auth/**", "app/api/auth/**", "middleware.ts");
  }
  if (rootCauseId === "rc.api_hardening") {
    files.push("app/api/**", "server/**/api/**");
  }
  if (rootCauseId === "rc.llm_controls") {
    files.push("server/**/llm/**", "app/api/**/chat/**");
  }
  if (/supabase/i.test(discoverySummary)) {
    files.push("supabase/migrations/**", "database/policies/**");
  }
  return files.length > 0 ? files : ["(inspect routes and services referenced by findings)"];
}

export function buildGroupedFixes(input: {
  rootCauses: RootCause[];
  findings: AttackFinding[];
  priorities: PrioritizedRemediation[];
  discoverySummary: string;
  replayPlanIdsByFinding: Map<string, string[]>;
}): GroupedFix[] {
  const findingById = new Map(input.findings.map((f) => [f.id, f]));

  return input.rootCauses.map((cause, index) => {
    const severityScore = cause.findingIds.reduce((sum, id) => {
      const f = findingById.get(id);
      return sum + (SEVERITY_WEIGHT[f?.severity ?? "medium"] ?? 40);
    }, 0);
    const priorityBoost = input.priorities
      .filter((p) => cause.findingIds.includes(p.findingId))
      .reduce((sum, p) => sum + p.score, 0);
    const priorityScore = severityScore + priorityBoost - index;

    const replayPlanIds = [
      ...new Set(cause.findingIds.flatMap((id) => input.replayPlanIdsByFinding.get(id) ?? [])),
    ];

    const dependsOnFixIds =
      cause.rootCauseId === "rc.authorization_boundary" && index > 0
        ? []
        : cause.rootCauseId !== "rc.session_auth" && input.rootCauses.some((c) => c.rootCauseId === "rc.session_auth")
          ? [`fix-rc.session_auth`]
          : [];

    return {
      fixId: `fix-${cause.rootCauseId}`,
      rootCauseId: cause.rootCauseId,
      title: cause.title,
      summary: cause.description,
      findingIds: cause.findingIds,
      dependsOnFixIds,
      priorityScore,
      recommendedVariant: "production_fix",
      strategies: strategyOptions(cause.rootCauseId),
      likelyFiles: likelyFilesForCause(cause.rootCauseId, input.discoverySummary),
      replayPlanIds,
    };
  }).sort((a, b) => b.priorityScore - a.priorityScore);
}

export function mergeFixesWithSharedSolution(fixes: GroupedFix[]): GroupedFix[] {
  const authz = fixes.find((f) => f.rootCauseId === "rc.authorization_boundary");
  const api = fixes.find((f) => f.rootCauseId === "rc.api_hardening");
  if (!authz || !api) return fixes;

  const mergedFindingIds = [...new Set([...authz.findingIds, ...api.findingIds])];
  if (mergedFindingIds.length <= authz.findingIds.length + 2) return fixes;

  const merged: GroupedFix = {
    ...authz,
    fixId: "fix-unified-authorization-middleware",
    title: "Unified authorization middleware (tenant, ownership, admin)",
    summary:
      "Consolidate tenant filters, ownership checks, and admin route guards into one middleware layer instead of scattered fixes.",
    findingIds: mergedFindingIds,
    replayPlanIds: [...new Set([...authz.replayPlanIds, ...api.replayPlanIds])],
    priorityScore: authz.priorityScore + api.priorityScore,
  };

  return [merged, ...fixes.filter((f) => f.rootCauseId !== "rc.api_hardening")];
}
