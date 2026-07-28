export type CancelReviewErrorCode =
  | "SCAN_NOT_FOUND"
  | "SCAN_NOT_CANCELLABLE"
  | "SCAN_ALREADY_CANCELLED"
  | "CANCEL_REQUEST_FAILED"
  | "CANCEL_SIGNAL_FAILED"
  | "STALE_REVIEW"
  | "REVIEW_NOT_FOUND"
  | "NOT_CANCELLABLE"
  | "ALREADY_COMPLETED"
  | "CANCEL_FAILED";

export function cancelReviewMessageKey(code: string | undefined): string {
  switch (code) {
    case "SCAN_NOT_FOUND":
    case "REVIEW_NOT_FOUND":
      return "cancelReviewErrorScanNotFound";
    case "SCAN_ALREADY_CANCELLED":
      return "cancelReviewErrorAlreadyCancelled";
    case "SCAN_NOT_CANCELLABLE":
    case "NOT_CANCELLABLE":
    case "ALREADY_COMPLETED":
      return "cancelReviewErrorNotCancellable";
    case "STALE_REVIEW":
      return "reviewNotActiveRefresh";
    case "CANCEL_SIGNAL_FAILED":
      return "cancelReviewErrorSignalFailed";
    case "CANCEL_REQUEST_FAILED":
    case "CANCEL_FAILED":
    default:
      return "cancelReviewError";
  }
}
