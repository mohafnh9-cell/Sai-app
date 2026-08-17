import type { ProductionReviewUiStatus } from "@/lib/review/production-review-state";

export type ScanCodeButtonState = "idle" | "running" | "completed" | "failed";

const RUNNING_STATUSES = new Set<ProductionReviewUiStatus>([
  "queued",
  "running",
  "analyzing",
  "cancelling",
]);

export function deriveScanCodeButtonState(input: {
  uiStatus: ProductionReviewUiStatus;
  requesting: boolean;
  reviewInProgress: boolean;
  hasCompletedAnalysis: boolean;
}): ScanCodeButtonState {
  if (
    input.requesting ||
    input.reviewInProgress ||
    RUNNING_STATUSES.has(input.uiStatus)
  ) {
    return "running";
  }

  if (
    input.uiStatus === "completed" ||
    input.uiStatus === "cancelled" ||
    input.hasCompletedAnalysis
  ) {
    return "completed";
  }

  if (input.uiStatus === "failed" || input.uiStatus === "stale") {
    return "failed";
  }

  return "idle";
}

export function scanCodeButtonDisabled(state: ScanCodeButtonState): boolean {
  return state === "running";
}

export function scanCodeButtonLabelKey(state: ScanCodeButtonState): string {
  switch (state) {
    case "idle":
      return "projectHome.scanCode.cta";
    case "running":
      return "projectHome.scanCode.running";
    case "completed":
      return "projectHome.scanCode.rescan";
    case "failed":
      return "projectHome.scanCode.retry";
  }
}
