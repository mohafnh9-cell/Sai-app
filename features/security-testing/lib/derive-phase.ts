import type { AttackExecutionStatus } from "@/server/attack-simulation/contracts/enums";
import type { SecurityTestPhase } from "../types";

const TERMINAL_CAMPAIGN_STATUSES = new Set(["completed", "failed", "cancelled"]);

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

  if (statuses.some((status) => status === "protected")) return "protected";
  if (statuses.some((status) => status === "fix_ready")) return "fix_ready";
  if (statuses.some((status) => status === "confirmed")) return "issues_found";

  if (!TERMINAL_CAMPAIGN_STATUSES.has(input.campaignStatus)) return "running";

  if (
    statuses.some(
      (status) => status === "confirmed" || status === "still_vulnerable" || status === "fix_ready"
    )
  ) {
    return "issues_found";
  }

  return "completed_clean";
}

export const TERMINAL_DISPLAY_PHASES = new Set<SecurityTestPhase>(["protected", "completed_clean"]);
