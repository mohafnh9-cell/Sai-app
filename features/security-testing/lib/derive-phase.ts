import type { AttackExecutionStatus } from "@/server/attack-simulation/contracts/enums";
import type { SecurityTestPhase } from "../types";

const TERMINAL_CAMPAIGN_STATUSES = new Set(["completed", "failed", "cancelled"]);

const SAFE_TERMINAL_EXECUTION_STATUSES = new Set<AttackExecutionStatus>([
  "protected",
  "not_exploitable",
  "blocked",
  "completed",
  "failed",
  "cancelled",
]);

export function deriveSecurityTestPhase(input: {
  reviewInProgress: boolean;
  hasLatestScan: boolean;
  campaignStatus: string | null;
  executionStatuses: AttackExecutionStatus[];
}): SecurityTestPhase {
  if (input.reviewInProgress) return "preparing";
  if (!input.hasLatestScan) return "needs_review";
  if (!input.campaignStatus) return "ready";

  const statuses = input.executionStatuses;

  // Worst-case first — never show "protected" while any execution still has open issues.
  if (statuses.some((status) => status === "still_vulnerable" || status === "confirmed")) {
    return "issues_found";
  }
  if (statuses.some((status) => status === "fix_ready")) {
    return "fix_ready";
  }
  if (!TERMINAL_CAMPAIGN_STATUSES.has(input.campaignStatus)) {
    return "running";
  }

  if (
    statuses.length > 0 &&
    statuses.every((status) => SAFE_TERMINAL_EXECUTION_STATUSES.has(status)) &&
    statuses.some((status) => status === "protected")
  ) {
    return "protected";
  }

  return "completed_clean";
}

export const TERMINAL_DISPLAY_PHASES = new Set<SecurityTestPhase>(["protected", "completed_clean"]);
