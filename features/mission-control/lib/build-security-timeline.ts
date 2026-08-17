import type { MissionControlState } from "@/features/mission-control/types/mission-control-state";
import type { ProductionIntelligence } from "@/brain/production-intelligence/schema";
import type { SecurityTimelineEvent } from "@/components/sequrai/SecurityTimeline";
import { verdictHeadlineDisplay } from "@/brain/production-verdict/status-ui";

export function buildSecurityTimelineEvents(
  state: MissionControlState,
  _intelligence?: ProductionIntelligence | null
): SecurityTimelineEvent[] {
  const events: SecurityTimelineEvent[] = [];
  const verdict = state.productionVerdict;

  for (const run of state.analysisRuns.slice(0, 5).reverse()) {
    if (run.createdAt) {
      events.push({
        id: `run-${run.runId}`,
        at: run.createdAt,
        label: `Analysis run ${run.status ?? "started"}`,
        tone: run.status === "failed" ? "danger" : run.status === "completed" ? "success" : "info",
      });
    }
  }

  if (state.status.lastAnalysisAt) {
    events.push({
      id: "last-analysis",
      at: state.status.lastAnalysisAt,
      label: "Repository analyzed",
      tone: "neutral",
    });
  }

  if (verdict) {
    const findingsCount = state.ui.fixPromptContext?.findings?.length ?? 0;
    if (findingsCount > 0 && state.status.lastAnalysisAt) {
      events.push({
        id: "findings-detected",
        at: state.status.lastAnalysisAt,
        label: `${findingsCount} findings detected`,
        tone: findingsCount > 0 ? "warning" : "neutral",
      });
    }

    if (verdict.introducedBlockers > 0 && state.status.lastAnalysisAt) {
      events.push({
        id: "risks-introduced",
        at: state.status.lastAnalysisAt,
        label: `${verdict.introducedBlockers} risk${verdict.introducedBlockers === 1 ? "" : "s"} introduced by latest change`,
        tone: "warning",
      });
    }

    events.push({
      id: "verdict-updated",
      at: verdict.generatedAt ?? state.status.lastAnalysisAt ?? new Date().toISOString(),
      label: `Production Verdict updated — ${verdictHeadlineDisplay(verdict.status)}`,
      tone:
        verdict.status === "ready_to_ship"
          ? "success"
          : verdict.status === "not_ready" || verdict.status === "analysis_failed"
            ? "danger"
            : "warning",
    });
  }

  if (_intelligence?.whatChanged.hasChanges && _intelligence.improvements[0]) {
    // Timeline uses verdict update as the consolidated change signal — i18n keys are rendered in WhatChangedSection.
  }

  return events
    .filter((e) => e.at)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .slice(-8);
}
