/**
 * Real scan status vocabulary from brain/automatic-review/review-status.ts --
 * only states the backend actually produces, grouped for display the same
 * way that module already groups them (queued / processing / completed / failed).
 */
export type ScanResultStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

const PROCESSING_SCAN_STATUSES = new Set([
  "fetching_repository",
  "indexing",
  "scanning",
  "calculating_score",
]);

export function scanResultStatus(rawStatus: string): ScanResultStatus {
  const status = rawStatus.toLowerCase();
  if (status === "queued") return "queued";
  if (status === "completed") return "completed";
  if (status === "cancelled" || status === "cancelling") return "cancelled";
  if (status === "failed") return "failed";
  if (PROCESSING_SCAN_STATUSES.has(status)) return "running";
  return "running";
}

export function scanResultStatusClass(status: ScanResultStatus): string {
  switch (status) {
    case "completed":
      return "border-success/30 bg-success/5 text-success";
    case "failed":
      return "border-danger/30 bg-danger/5 text-danger";
    case "running":
      return "border-primary/30 bg-primary/5 text-primary";
    case "queued":
    case "cancelled":
      return "border-border bg-muted/30 text-muted-foreground";
  }
}
