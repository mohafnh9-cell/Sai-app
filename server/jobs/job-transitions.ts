import type { ScanJobStatus } from "@/server/jobs/types";

const VALID_TRANSITIONS: Record<ScanJobStatus, ScanJobStatus[]> = {
  queued: ["running", "failed", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransitionScanJob(from: ScanJobStatus, to: ScanJobStatus): boolean {
  if (to === "queued") return false;
  return VALID_TRANSITIONS[from].includes(to);
}

export function canRecoverScanJobToQueued(from: ScanJobStatus): boolean {
  return from === "queued" || from === "running";
}

export function assertScanJobTransition(from: ScanJobStatus, to: ScanJobStatus): void {
  if (!canTransitionScanJob(from, to)) {
    throw new Error(`Invalid scan job transition: ${from} → ${to}`);
  }
}

export function isTerminalScanJobStatus(status: ScanJobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export const ALLOWED_SOURCE_STATUSES = {
  running: ["queued", "running"] as ScanJobStatus[],
  completed: ["running"] as ScanJobStatus[],
  failed: ["queued", "running"] as ScanJobStatus[],
  cancelled: ["queued", "running"] as ScanJobStatus[],
  queued: ["queued", "running"] as ScanJobStatus[],
} as const;
