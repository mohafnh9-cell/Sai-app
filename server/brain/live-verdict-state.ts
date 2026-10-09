import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BrainVerdictState, ProjectBrainSummary } from "@/brain";
import { scanInBranchScope } from "@/server/review-start/branch-scope";
import { isVerdictMaterializing, VERDICT_MATERIALIZATION_WINDOW_MS } from "@/server/production-verdict/pending-verdict";

const ACTIVE_STATUSES = ["queued", "fetching_repository", "indexing", "scanning", "calculating_score"];

type ScanRow = { id: string; project_id: string; branch: string | null; status: string; completed_at?: string | null };

/**
 * Whether each project's persisted verdict is still the current decision, computed from LIVE scan state.
 * It is deliberately separate from the 20 s snapshot cache: a scan that starts (or completes) after the snapshot was
 * cached must be visible immediately. Returns null when the live state cannot be read.
 */
export async function loadLiveVerdictStates(
  supabase: SupabaseClient,
  organizationId: string,
  summaries: ProjectBrainSummary[]
): Promise<Map<string, BrainVerdictState> | null> {
  try {
    const since = new Date(Date.now() - VERDICT_MATERIALIZATION_WINDOW_MS).toISOString();
    const [projects, active, recent] = await Promise.all([
      supabase.from("projects").select("id, github_default_branch").eq("organization_id", organizationId),
      supabase
        .from("scans")
        .select("id, project_id, branch, status")
        .eq("organization_id", organizationId)
        .in("status", ACTIVE_STATUSES)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("scans")
        .select("id, project_id, branch, status, completed_at")
        .eq("organization_id", organizationId)
        .eq("status", "completed")
        .gte("completed_at", since)
        .order("completed_at", { ascending: false })
        .limit(500),
    ]);
    if (projects.error || active.error || recent.error) return null;

    const defaultBranch = new Map(
      ((projects.data ?? []) as Array<{ id: string; github_default_branch: string | null }>).map((p) => [p.id, p.github_default_branch ?? null])
    );
    const inScope = (row: ScanRow) => scanInBranchScope(row.branch, null, defaultBranch.get(row.project_id) ?? null);
    const runningProjects = new Set(((active.data ?? []) as ScanRow[]).filter(inScope).map((row) => row.project_id));
    const latestRecent = new Map<string, ScanRow>();
    for (const row of (recent.data ?? []) as ScanRow[]) {
      if (inScope(row) && !latestRecent.has(row.project_id)) latestRecent.set(row.project_id, row);
    }

    const states = new Map<string, BrainVerdictState>();
    for (const summary of summaries) {
      if (!summary.verdictScanId) {
        // No verdict (or a snapshot cached before verdictScanId existed: unknown, treated conservatively below).
        if (summary.verdictState === "none") states.set(summary.projectId, "none");
        else if (runningProjects.has(summary.projectId)) states.set(summary.projectId, "historical_review_in_progress");
        continue;
      }
      if (runningProjects.has(summary.projectId)) {
        states.set(summary.projectId, "historical_review_in_progress");
        continue;
      }
      const latest = latestRecent.get(summary.projectId);
      states.set(
        summary.projectId,
        latest && latest.id !== summary.verdictScanId && isVerdictMaterializing(latest) ? "pending_verdict" : "current"
      );
    }
    return states;
  } catch {
    return null;
  }
}

/** A verdict that is not current is context, not a decision: no affirmation, no current score. */
export function applyLiveVerdictStates(
  summaries: ProjectBrainSummary[],
  states: Map<string, BrainVerdictState> | null
): ProjectBrainSummary[] {
  return summaries.map((summary) => {
    if (!states) {
      // Live state unavailable: unknown is not safe -- never keep an affirmation we could not confirm.
      return { ...summary, affirmsDeploy: false };
    }
    const state = states.get(summary.projectId);
    if (!state) {
      // Old cached snapshot without verdictScanId and nothing running: cannot confirm it is current.
      return summary.verdictScanId === undefined ? { ...summary, affirmsDeploy: false, verdictState: summary.verdictState } : summary;
    }
    if (state === "historical_review_in_progress" || state === "pending_verdict") {
      return { ...summary, verdictState: state, affirmsDeploy: false, productionReady: null };
    }
    return { ...summary, verdictState: state };
  });
}
