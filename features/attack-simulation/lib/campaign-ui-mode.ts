import type { AttackCenterSnapshot } from "../types";
import {
  deriveLiveTestPhase,
} from "@/features/security-testing/lib/live-test-copy";
import { TERMINAL_DISPLAY_PHASES } from "@/features/security-testing/lib/derive-phase";

export type AttackCampaignUiMode = "none" | "running" | "complete";

export function deriveAttackCampaignUiMode(
  snapshot: AttackCenterSnapshot | null
): AttackCampaignUiMode {
  if (!snapshot || snapshot.kind !== "campaign") {
    return "none";
  }

  const phase = deriveLiveTestPhase(snapshot);
  if (phase === "running" || phase === "preparing") {
    return "running";
  }
  if (
    TERMINAL_DISPLAY_PHASES.has(phase) ||
    phase === "fix_ready" ||
    phase === "issues_found"
  ) {
    return "complete";
  }

  return "none";
}
