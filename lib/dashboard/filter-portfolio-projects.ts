import type { ProjectBrainSummary } from "@/brain";
import type { VerdictStatus } from "@/brain/production-verdict/schema";

const NEEDS_ATTENTION_STATUSES: VerdictStatus[] = [
  "not_ready",
  "needs_improvement",
  "analysis_failed",
];

const STALE_MS = 7 * 24 * 60 * 60 * 1000;

export function projectNeedsAttention(
  summary: ProjectBrainSummary | undefined,
  lastActivityAt: string | null
): boolean {
  const status = summary?.status ?? "insufficient_data";
  if (NEEDS_ATTENTION_STATUSES.includes(status)) return true;
  if (!lastActivityAt) return false;
  const age = Date.now() - new Date(lastActivityAt).getTime();
  return age > STALE_MS && status !== "ready_to_ship";
}

export function partitionPortfolioProjects<
  T extends { id: string; last_scan_at: string | null; created_at: string }
>(
  projects: T[],
  summaries: Map<string, ProjectBrainSummary>
): { needsAttention: T[]; all: T[] } {
  const needsAttention = projects.filter((project) =>
    projectNeedsAttention(
      summaries.get(project.id),
      project.last_scan_at ?? project.created_at
    )
  );
  return { needsAttention, all: projects };
}
