export type ReviewPipelinePhase =
  | "QUEUED"
  | "DISCOVERY"
  | "STATIC_ANALYSIS"
  | "RED_TEAM"
  | "ATTACK_SIMULATION"
  | "SAFE_FIX"
  | "PROTECTION_VERIFICATION"
  | "PRODUCTION_VERDICT"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export const REVIEW_PIPELINE_ORDER: readonly ReviewPipelinePhase[] = [
  "QUEUED",
  "DISCOVERY",
  "STATIC_ANALYSIS",
  "RED_TEAM",
  "ATTACK_SIMULATION",
  "SAFE_FIX",
  "PROTECTION_VERIFICATION",
  "PRODUCTION_VERDICT",
  "COMPLETED",
] as const;

const TERMINAL_PHASES = new Set<ReviewPipelinePhase>(["COMPLETED", "FAILED", "CANCELLED"]);

export type ReviewPhaseProgress = {
  phase: ReviewPipelinePhase;
  percentage: number;
  message: string;
  elapsedMs?: number;
  estimatedRemainingMs?: number;
  logs?: string[];
};

export function phaseIndex(phase: ReviewPipelinePhase): number {
  const index = REVIEW_PIPELINE_ORDER.indexOf(phase);
  return index >= 0 ? index : 0;
}

export function canTransitionReviewPhase(
  from: ReviewPipelinePhase,
  to: ReviewPipelinePhase
): boolean {
  if (from === to) return true;
  if (TERMINAL_PHASES.has(from)) return false;
  if (to === "FAILED" || to === "CANCELLED") return true;
  if (TERMINAL_PHASES.has(to) && to !== "COMPLETED") return true;

  const fromIndex = phaseIndex(from);
  const toIndex = phaseIndex(to);
  return toIndex === fromIndex + 1 || (from === "PRODUCTION_VERDICT" && to === "COMPLETED");
}

export function assertReviewPhaseTransition(
  from: ReviewPipelinePhase,
  to: ReviewPipelinePhase
): void {
  if (!canTransitionReviewPhase(from, to)) {
    throw new Error(`Invalid review phase transition: ${from} → ${to}`);
  }
}

export function mapScanStatusToReviewPhase(scanStatus: string): ReviewPipelinePhase {
  switch (scanStatus) {
    case "queued":
      return "QUEUED";
    case "fetching_repository":
      return "DISCOVERY";
    case "indexing":
      return "DISCOVERY";
    case "scanning":
      return "STATIC_ANALYSIS";
    case "calculating_score":
      return "PROTECTION_VERIFICATION";
    case "completed":
      return "COMPLETED";
    case "failed":
      return "FAILED";
    case "cancelled":
      return "CANCELLED";
    default:
      return "QUEUED";
  }
}

export function reviewPhaseProgressForScan(input: {
  scanStatus: string;
  progress?: number | null;
  message?: string | null;
  startedAtMs?: number | null;
}): ReviewPhaseProgress {
  const phase = mapScanStatusToReviewPhase(input.scanStatus);
  const orderIndex = phaseIndex(phase);
  const basePercent = Math.round((orderIndex / (REVIEW_PIPELINE_ORDER.length - 1)) * 100);
  const scanProgress = typeof input.progress === "number" ? input.progress : basePercent;
  const percentage = phase === "COMPLETED" ? 100 : Math.max(basePercent, Math.min(99, scanProgress));

  const elapsedMs =
    input.startedAtMs != null ? Math.max(0, Date.now() - input.startedAtMs) : undefined;
  const estimatedRemainingMs =
    elapsedMs != null && percentage > 0 && percentage < 100
      ? Math.round((elapsedMs / percentage) * (100 - percentage))
      : undefined;

  return {
    phase,
    percentage,
    message: input.message ?? phase.replaceAll("_", " ").toLowerCase(),
    elapsedMs,
    estimatedRemainingMs,
  };
}

export function mergeReviewPipelineMetadata(
  existing: Record<string, unknown> | null | undefined,
  update: {
    phase: ReviewPipelinePhase;
    percentage: number;
    message: string;
    log?: string;
  }
): Record<string, unknown> {
  const prior = existing ?? {};
  const priorPhase = (prior.reviewPhase as ReviewPipelinePhase | undefined) ?? "QUEUED";
  if (!canTransitionReviewPhase(priorPhase, update.phase) && priorPhase !== update.phase) {
    return prior;
  }

  const logs = Array.isArray(prior.phaseLogs) ? [...(prior.phaseLogs as string[])] : [];
  if (update.log) logs.push(update.log);

  return {
    ...prior,
    reviewPhase: update.phase,
    reviewPhasePercent: update.percentage,
    reviewPhaseMessage: update.message,
    phaseLogs: logs.slice(-50),
  };
}
