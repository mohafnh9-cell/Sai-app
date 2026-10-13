import type { MissionControlState } from "@/features/mission-control/types/mission-control-state";

/**
 * Which analysis the person is looking at versus the newest one, so decisions are never mixed without saying where they come from.
 *
 *  - A page opened with `?run=` is PINNED to that analysis: it never changes by itself.
 *  - A page without `run` shows the newest analysis as of when it was loaded; it does not swap itself while idle either.
 * Either way, if the newest analysis is a different one, the person is told (with a link); the view is never replaced silently.
 */
export type RunBrief = {
  runId: string;
  commitSha: string | null;
  createdAt: string;
  status: string;
};

export type RunContextNotice =
  | { kind: "older"; selected: RunBrief | null; latest: RunBrief }
  | { kind: "newer_detected"; selected: RunBrief | null; latest: RunBrief };

type StateLike = Pick<MissionControlState, "analysisRunId" | "latestRun" | "analysisRuns"> & {
  productionVerdict?: { scanId?: string | null } | null;
  ui?: { viewingHistoricalRun?: boolean };
};

const brief = (run: { runId: string; commitSha: string | null; createdAt: string; status: string }): RunBrief => ({
  runId: run.runId,
  commitSha: run.commitSha,
  createdAt: run.createdAt,
  status: run.status,
});

export function deriveRunContext(input: {
  state: StateLike;
  /** The newest analysis as of the page's first render (what a page without `run` was showing). */
  initialLatestRunId: string | null;
  /** The newest analysis according to the idle probe, when it has answered. */
  probedLatest?: RunBrief | null;
}): RunContextNotice | null {
  const { state, initialLatestRunId } = input;
  // An active review of ANOTHER scan already has its own banner (viewingHistoricalRun): do not say it twice.
  if (state.ui?.viewingHistoricalRun) return null;

  const latest: RunBrief | null = input.probedLatest ?? (state.latestRun ? brief(state.latestRun) : null);
  if (!latest) return null;

  // What the page actually shows: the pinned run, else the analysis its verdict belongs to, else the newest at load.
  const displayedRunId = state.analysisRunId ?? state.productionVerdict?.scanId ?? initialLatestRunId ?? latest.runId;
  if (latest.runId === displayedRunId) return null;

  const selectedRun = state.analysisRuns.find((run) => run.runId === displayedRunId) ?? null;
  const selected = selectedRun ? brief(selectedRun) : null;
  // The newest analysis appeared AFTER this page loaded (a push or another person) vs. the page was opened on an older one.
  const appearedSinceLoad = initialLatestRunId !== null && latest.runId !== initialLatestRunId;
  return { kind: appearedSinceLoad ? "newer_detected" : "older", selected, latest };
}
