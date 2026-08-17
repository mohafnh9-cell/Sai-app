import type { VerdictStatus } from "@/brain/production-verdict/schema";
import type { Translator } from "@/lib/i18n/types";

const VERDICT_STATUSES = new Set<string>([
  "ready_to_ship",
  "almost_ready",
  "needs_improvement",
  "not_ready",
  "insufficient_data",
  "analysis_failed",
]);

const RUN_STATUS_KEYS: Record<string, string> = {
  completed: "analysisRun.selector.runStatus.completed",
  running: "analysisRun.selector.runStatus.running",
  failed: "analysisRun.selector.runStatus.failed",
  queued: "analysisRun.selector.runStatus.queued",
  cancelled: "analysisRun.selector.runStatus.cancelled",
  unknown: "analysisRun.selector.runStatus.unknown",
};

export function formatAnalysisRunStatusLabel(
  status: string | null,
  t: Translator,
  tVerdict: Translator
): string {
  if (!status) {
    return t("analysisRun.selector.runStatus.unknown");
  }

  if (VERDICT_STATUSES.has(status)) {
    return tVerdict(`status.${status as VerdictStatus}.label`);
  }

  const key = RUN_STATUS_KEYS[status];
  return key ? t(key) : status;
}
