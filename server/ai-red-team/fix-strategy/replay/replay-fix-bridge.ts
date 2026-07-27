import type { AttackResult } from "../../types";
import type { GroupedFix, ReplayFixLink } from "../fix-strategy.types";

export type CollectedReplayPlan = {
  replayPlanId: string;
  findingId?: string;
  team?: string;
};

export function collectReplayPlansFromResults(results: AttackResult[]): CollectedReplayPlan[] {
  const plans: CollectedReplayPlan[] = [];
  for (const result of results) {
    const raw = result.metadata?.replayPlans;
    if (!Array.isArray(raw)) continue;
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const plan = entry as Record<string, unknown>;
      const replayPlanId = String(plan.replayPlanId ?? plan.id ?? "");
      if (!replayPlanId) continue;
      plans.push({
        replayPlanId,
        findingId: plan.findingId ? String(plan.findingId) : undefined,
        team: result.domain,
      });
    }
  }
  return plans;
}

export function buildReplayFixLinks(input: {
  groupedFixes: GroupedFix[];
  replayPlans: CollectedReplayPlan[];
  replayStatus: "not_run" | "passed" | "failed";
}): ReplayFixLink[] {
  const statusForAll =
    input.replayStatus === "passed"
      ? "passed"
      : input.replayStatus === "failed"
        ? "failed"
        : "not_run";

  const links: ReplayFixLink[] = [];
  for (const fix of input.groupedFixes) {
    for (const replayPlanId of fix.replayPlanIds) {
      links.push({
        replayPlanId,
        findingIds: fix.findingIds,
        fixId: fix.fixId,
        status: statusForAll,
      });
    }
  }

  if (links.length === 0 && input.replayPlans.length > 0) {
    for (const plan of input.replayPlans) {
      links.push({
        replayPlanId: plan.replayPlanId,
        findingIds: plan.findingId ? [plan.findingId] : [],
        fixId: input.groupedFixes[0]?.fixId ?? "fix-general",
        status: statusForAll,
      });
    }
  }

  return links;
}

export function mapFindingToReplayIds(
  replayPlans: CollectedReplayPlan[]
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const plan of replayPlans) {
    if (!plan.findingId) continue;
    const list = map.get(plan.findingId) ?? [];
    list.push(plan.replayPlanId);
    map.set(plan.findingId, list);
  }
  return map;
}

export function shouldGenerateAlternateStrategy(replayStatus: "not_run" | "passed" | "failed"): boolean {
  return replayStatus === "failed";
}
