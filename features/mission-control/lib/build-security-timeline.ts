import type { MissionControlState } from "@/features/mission-control/types/mission-control-state";
import type { ProductionIntelligence } from "@/brain/production-intelligence/schema";
import type { SecurityTimelineEvent } from "@/components/sequrai/SecurityTimeline";
import type { VerdictStatus } from "@/brain/production-verdict/schema";

export type SecurityTimelineCopy = {
  analysisRun: (status: string) => string;
  repositoryAnalyzed: string;
  findingsDetected: (count: number) => string;
  risksIntroduced: (count: number) => string;
  verdictUpdated: (headline: string) => string;
  verdictHeadline: (status: VerdictStatus) => string;
};

export function buildSecurityTimelineEvents(
  state: MissionControlState,
  copy: SecurityTimelineCopy,
  _intelligence?: ProductionIntelligence | null
): SecurityTimelineEvent[] {
  const events: SecurityTimelineEvent[] = [];
  const verdict = state.productionVerdict;

  for (const run of state.analysisRuns.slice(0, 5).reverse()) {
    if (run.createdAt) {
      events.push({
        id: `run-${run.runId}`,
        at: run.createdAt,
        label: copy.analysisRun(run.status ?? "started"),
        tone: run.status === "failed" ? "danger" : run.status === "completed" ? "success" : "info",
      });
    }
  }

  if (state.status.lastAnalysisAt) {
    events.push({
      id: "last-analysis",
      at: state.status.lastAnalysisAt,
      label: copy.repositoryAnalyzed,
      tone: "neutral",
    });
  }

  if (verdict) {
    const findingsCount = state.ui.fixPromptContext?.findings?.length ?? 0;
    if (findingsCount > 0 && state.status.lastAnalysisAt) {
      events.push({
        id: "findings-detected",
        at: state.status.lastAnalysisAt,
        label: copy.findingsDetected(findingsCount),
        tone: findingsCount > 0 ? "warning" : "neutral",
      });
    }

    if (verdict.introducedBlockers > 0 && state.status.lastAnalysisAt) {
      events.push({
        id: "risks-introduced",
        at: state.status.lastAnalysisAt,
        label: copy.risksIntroduced(verdict.introducedBlockers),
        tone: "warning",
      });
    }

    events.push({
      id: "verdict-updated",
      at: verdict.generatedAt ?? state.status.lastAnalysisAt ?? new Date().toISOString(),
      label: copy.verdictUpdated(copy.verdictHeadline(verdict.status)),
      tone:
        verdict.status === "ready_to_ship"
          ? "success"
          : verdict.status === "not_ready" || verdict.status === "analysis_failed"
            ? "danger"
            : "warning",
    });
  }

  return events
    .filter((e) => e.at)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .slice(-8);
}
