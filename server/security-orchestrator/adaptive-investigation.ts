import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getDynamicTargetAuthorizationStatus } from "@/server/ai-red-team/authorization/dynamic-target-authorization-service";
import { isNetworkEgressEnforced } from "./network-enforcement";
import type { SequrAIFinding } from "@/server/security-evidence/canonical-finding";
import type { InvestigationDecision } from "./types";

const ESCALATION_TRIGGER_CATEGORIES = new Set(["ssrf", "injection", "authorization"]);

/**
 * Phase 36, section 13/14: reacts to evidence instead of blindly running
 * (or blindly skipping) expensive follow-up analysis. Real findings from
 * STAGE 1 (OpenGrep/native/etc.) are checked against real preconditions --
 * an authorized dynamic target AND actual network enforcement (section 15:
 * "Dynamic planning MUST verify that real network enforcement exists
 * before scheduling target-URL-based execution. If enforcement is absent,
 * dynamic execution must be rejected or remain explicitly unavailable.").
 * Today, isNetworkEgressEnforced() is honestly false (Phase 35.5's
 * network_policy is descriptive only) -- so every trigger here correctly,
 * consistently, and transparently declines escalation with a real reason,
 * rather than silently skipping or fabricating an investigation.
 */
export async function runAdaptiveInvestigation(
  admin: SupabaseClient,
  input: { organizationId: string; projectId: string; findings: SequrAIFinding[] }
): Promise<InvestigationDecision[]> {
  const triggers = input.findings.filter((f) => ESCALATION_TRIGGER_CATEGORIES.has(f.category.toLowerCase()));
  if (triggers.length === 0) return [];

  const enforcementActive = isNetworkEgressEnforced();
  const authStatus = await getDynamicTargetAuthorizationStatus(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
  }).catch(() => null);

  const decisions: InvestigationDecision[] = [];
  for (const finding of triggers) {
    if (!enforcementActive) {
      decisions.push({
        triggerFindingId: finding.id,
        triggerReason: `${finding.category} finding "${finding.title}" would normally justify dynamic investigation.`,
        escalated: false,
        reason:
          "Real network egress enforcement is not active for this deployment (Phase 35.5's network_policy remains descriptive metadata only) -- escalating to a live network call would be a false security control, so investigation was NOT performed. Fix: deploy OS/container-level egress enforcement before enabling this.",
      });
      continue;
    }
    if (!authStatus?.authorized) {
      decisions.push({
        triggerFindingId: finding.id,
        triggerReason: `${finding.category} finding "${finding.title}" would normally justify dynamic investigation.`,
        escalated: false,
        reason: "No authorized dynamic target exists for this project -- reuse authorize_dynamic_target to grant one before deeper investigation can run.",
      });
      continue;
    }
    // Both preconditions hold (network enforcement real AND target
    // authorized) -- this branch is unreachable today given
    // isNetworkEgressEnforced() is hardcoded false, and that is
    // intentional and documented, not a bug (see network-enforcement.ts).
    decisions.push({
      triggerFindingId: finding.id,
      triggerReason: `${finding.category} finding "${finding.title}" justified dynamic investigation.`,
      escalated: true,
      reason: `Authorized target and real network enforcement both confirmed -- escalated for deeper validation against ${authStatus.targetOrigin ?? "the authorized target"}.`,
    });
  }
  return decisions;
}
