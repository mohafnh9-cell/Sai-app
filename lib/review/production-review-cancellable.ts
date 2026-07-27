import type { ScanJobStatus } from "@/server/jobs/types";
import type { ScanStatus } from "@/types/database";

const TERMINAL_SCAN_STATUSES = new Set<string>([
  "completed",
  "failed",
  "cancelled",
  "cancelling",
]);

const ACTIVE_SCAN_STATUSES = new Set<string>([
  "queued",
  "fetching_repository",
  "indexing",
  "scanning",
  "calculating_score",
]);

const ACTIVE_SCAN_JOB_STATUSES = new Set<string>(["queued", "running"]);

export function normalizeProductionReviewStatus(
  status: string | null | undefined
): string {
  if (!status) return "";
  return status.trim().toLowerCase().replace(/-/g, "_");
}

export function isProductionReviewCancellable(input: {
  scanStatus?: string | null;
  scanJobStatus?: string | null;
}): boolean {
  const scan = normalizeProductionReviewStatus(input.scanStatus);
  const job = normalizeProductionReviewStatus(input.scanJobStatus);

  if (scan && TERMINAL_SCAN_STATUSES.has(scan)) {
    return false;
  }

  if (scan && ACTIVE_SCAN_STATUSES.has(scan)) {
    return true;
  }

  if (job && ACTIVE_SCAN_JOB_STATUSES.has(job)) {
    return true;
  }

  return false;
}

/** @deprecated Use isProductionReviewCancellable */
export const CANCELLABLE_SCAN_STATUSES = [
  "queued",
  "fetching_repository",
  "indexing",
  "scanning",
  "calculating_score",
] as const satisfies readonly ScanStatus[];

export function isCancellableScanStatus(status: string | null | undefined): boolean {
  return isProductionReviewCancellable({ scanStatus: status });
}

export function isScanCancellationTerminal(status: string | null | undefined): boolean {
  const normalized = normalizeProductionReviewStatus(status);
  return normalized === "cancelled" || normalized === "cancelling";
}

export function scanStatusShowsCancelButton(input: {
  scanStatus?: string | null;
  scanJobStatus?: string | null;
}): boolean {
  return isProductionReviewCancellable(input);
}

export function isCancellableScanJobStatus(status: ScanJobStatus | string | null | undefined): boolean {
  const normalized = normalizeProductionReviewStatus(status);
  return normalized === "queued" || normalized === "running";
}
