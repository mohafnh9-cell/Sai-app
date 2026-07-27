import type { ScanStatus } from "@/types/database";

/** Scan statuses where the user may request cancellation (matches QUEUED / RUNNING / ANALYZING). */
export const CANCELLABLE_SCAN_STATUSES: readonly ScanStatus[] = [
  "queued",
  "fetching_repository",
  "indexing",
  "scanning",
  "calculating_score",
] as const;

export function isCancellableScanStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return (CANCELLABLE_SCAN_STATUSES as readonly string[]).includes(status);
}

export function isScanCancellationTerminal(status: string | null | undefined): boolean {
  return status === "cancelled" || status === "cancelling";
}

export function scanStatusShowsCancelButton(status: string | null | undefined): boolean {
  return isCancellableScanStatus(status);
}
