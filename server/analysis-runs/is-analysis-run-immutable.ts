import "server-only";

const TERMINAL_SCAN_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function isTerminalScanStatus(status: string): boolean {
  return TERMINAL_SCAN_STATUSES.has(status);
}

export function isAnalysisRunImmutable(input: {
  status: string;
  immutabilityLockedAt?: string | null;
}): boolean {
  if (input.immutabilityLockedAt) return true;
  return isTerminalScanStatus(input.status);
}
