import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SafeFixLifecycleState } from "./types";
import { storeSafeFixHistoryUpdate } from "./history";

const ALLOWED: Record<SafeFixLifecycleState, SafeFixLifecycleState[]> = {
  PROPOSED: ["READY", "SUPERSEDED"],
  READY: ["APPROVED", "SUPERSEDED"],
  APPROVED: ["APPLIED", "READY", "SUPERSEDED"],
  APPLIED: ["VERIFYING", "FAILED"],
  VERIFYING: ["VERIFIED", "FAILED"],
  VERIFIED: ["READY"],
  FAILED: ["READY", "SUPERSEDED"],
  SUPERSEDED: [],
};

/**
 * APPROVED / VERIFIED -> READY exists for one reason only: the proposal's commit changed, so the
 * earlier approval or verification no longer describes the current content.
 */
export const PROPOSAL_CHANGED_REASON = "proposal_commit_changed";

export async function transitionSafeFixState(
  admin: SupabaseClient,
  input: {
    safeFixId: string;
    organizationId: string;
    projectId: string;
    toState: SafeFixLifecycleState;
    actor: string;
    reason: string;
    fromState?: SafeFixLifecycleState | null;
    relatedReviewId?: string | null;
    relatedRecommendationId?: string | null;
  }
): Promise<void> {
  const { data: row } = await admin
    .from("safe_fix_records")
    .select("lifecycle_state")
    .eq("id", input.safeFixId)
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .maybeSingle();

  // A record outside this organization/project is not a PROPOSED record: never default to it.
  if (!row) throw new Error("safe_fix_not_found");

  const from = (input.fromState ?? (row.lifecycle_state as SafeFixLifecycleState)) ?? "PROPOSED";
  if (!ALLOWED[from]?.includes(input.toState)) {
    throw new Error(`invalid_transition:${from}->${input.toState}`);
  }
  if (
    (from === "VERIFIED" || from === "APPROVED") &&
    input.toState === "READY" &&
    !input.reason.startsWith(PROPOSAL_CHANGED_REASON)
  ) {
    throw new Error(`invalid_transition:${from}->${input.toState}`);
  }

  await storeSafeFixHistoryUpdate(
    admin,
    input.safeFixId,
    { lifecycleState: input.toState },
    { organizationId: input.organizationId, projectId: input.projectId }
  );

  await admin.from("safe_fix_lifecycle_events").insert({
    organization_id: input.organizationId,
    project_id: input.projectId,
    safe_fix_id: input.safeFixId,
    from_state: from,
    to_state: input.toState,
    actor: input.actor,
    reason: input.reason,
    related_review_id: input.relatedReviewId ?? null,
    related_recommendation_id: input.relatedRecommendationId ?? null,
  });
}
