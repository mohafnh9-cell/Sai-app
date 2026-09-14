import "server-only";

import type { SecurityJobStatus } from "./types";

/**
 * Phase 35.5, section 5: a deterministic lifecycle -- no arbitrary state
 * transition is permitted.
 */
const ALLOWED_TRANSITIONS: Record<SecurityJobStatus, SecurityJobStatus[]> = {
  QUEUED: ["RUNNING", "CANCELLED", "REJECTED"],
  RUNNING: ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
  TIMED_OUT: [],
  REJECTED: [],
};

export function isValidJobTransition(from: SecurityJobStatus, to: SecurityJobStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function isTerminalJobStatus(status: SecurityJobStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

export class InvalidJobTransitionError extends Error {
  constructor(
    public readonly from: SecurityJobStatus,
    public readonly to: SecurityJobStatus
  ) {
    super(`Invalid security job state transition: ${from} -> ${to}`);
    this.name = "InvalidJobTransitionError";
  }
}

export function assertValidJobTransition(from: SecurityJobStatus, to: SecurityJobStatus): void {
  if (!isValidJobTransition(from, to)) {
    throw new InvalidJobTransitionError(from, to);
  }
}
