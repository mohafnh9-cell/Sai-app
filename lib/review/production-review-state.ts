export type ProductionReviewUiStatus =
  | "idle"
  | "queued"
  | "running"
  | "analyzing"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "failed"
  | "stale";

export type ProductionReviewState = {
  hasActiveReview: boolean;
  scanId: string | null;
  scanJobId: string | null;
  status: ProductionReviewUiStatus;
  isCancellable: boolean;
  commitSha: string | null;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  failureMessage: string | null;
};

export function mapScanStatusToProductionReviewUiStatus(
  scanStatus: string | null | undefined
): ProductionReviewUiStatus {
  const scan = (scanStatus ?? "").trim().toLowerCase();
  switch (scan) {
    case "queued":
      return "queued";
    case "fetching_repository":
    case "indexing":
      return "running";
    case "scanning":
    case "calculating_score":
      return "analyzing";
    case "cancelling":
      return "cancelling";
    case "cancelled":
      return "cancelled";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "idle";
  }
}

export const SPINNER_UI_STATUSES = new Set<ProductionReviewUiStatus>([
  "queued",
  "running",
  "analyzing",
  "cancelling",
]);

export function productionReviewShowsSpinner(status: ProductionReviewUiStatus): boolean {
  return SPINNER_UI_STATUSES.has(status);
}

export function productionReviewHasActiveWork(
  status: ProductionReviewUiStatus,
  hasActiveReview: boolean
): boolean {
  return hasActiveReview && productionReviewShowsSpinner(status);
}
