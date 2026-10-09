import type { ProjectBrainSummary } from "@/brain";
import type { ProductionVerdictV1, VerdictStatus } from "@/brain/production-verdict/schema";

const STATUS_WEIGHT: Record<VerdictStatus, number> = {
  not_ready: 0,
  analysis_failed: 1,
  needs_improvement: 2,
  insufficient_data: 3,
  almost_ready: 4,
  ready_to_ship: 5,
};

/** A persisted verdict that is not the current decision (a newer review is running / its verdict is pending). */
export function isHistoricalSummary(project: ProjectBrainSummary): boolean {
  return project.verdictState === "historical_review_in_progress" || project.verdictState === "pending_verdict";
}

export type DashboardFocus = {
  primary: ProjectBrainSummary;
  /** The primary project's verdict is historical: show "analysis in progress", never a deployment answer. */
  primaryHistorical: boolean;
  verdict: ProductionVerdictV1 | null;
  orgCanDeploy: boolean;
  topPriority: ProductionVerdictV1["topPriorities"][number] | null;
};

export function pickPrimaryDashboardFocus(
  projects: ProjectBrainSummary[],
  verdicts: Map<string, ProductionVerdictV1>
): DashboardFocus | null {
  if (!projects.length) return null;

  const ranked = [...projects].sort((a, b) => {
    // Projects with a CURRENT verdict come first; a historical one only leads when nothing else can.
    const historicalA = isHistoricalSummary(a) ? 1 : 0;
    const historicalB = isHistoricalSummary(b) ? 1 : 0;
    if (historicalA !== historicalB) return historicalA - historicalB;
    const weightA = STATUS_WEIGHT[a.status] ?? 99;
    const weightB = STATUS_WEIGHT[b.status] ?? 99;
    if (weightA !== weightB) return weightA - weightB;
    return (b.blockersCount ?? 0) - (a.blockersCount ?? 0);
  });

  const primary = ranked[0];
  const verdict = verdicts.get(primary.projectId) ?? null;
  // The affirmative "yes, deploy" answer needs more than a ready_to_ship status:
  // every project's verdict must pass the canonical evidence gate (high
  // confidence AND complete coverage). A missing flag means "not affirmed".
  const orgCanDeploy =
    projects.length > 0 &&
    projects.every(
      (project) => project.status === "ready_to_ship" && project.affirmsDeploy === true && !isHistoricalSummary(project)
    );
  const primaryHistorical = isHistoricalSummary(primary);

  return {
    primary,
    primaryHistorical,
    verdict: primaryHistorical ? null : verdict,
    orgCanDeploy,
    topPriority: primaryHistorical ? null : verdict?.topPriorities[0] ?? null,
  };
}

export function greetingKeyForHour(hour: number): "greetingMorning" | "greetingAfternoon" | "greetingEvening" {
  if (hour < 12) return "greetingMorning";
  if (hour < 18) return "greetingAfternoon";
  return "greetingEvening";
}

export function firstNameFromUser(input: {
  fullName?: string | null;
  email?: string | null;
}): string {
  const fromName = input.fullName?.trim().split(/\s+/)[0];
  if (fromName) return fromName;
  const fromEmail = input.email?.split("@")[0]?.trim();
  return fromEmail ? fromEmail.charAt(0).toUpperCase() + fromEmail.slice(1) : "there";
}
