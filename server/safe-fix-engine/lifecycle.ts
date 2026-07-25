import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SafeFixLifecycleState } from "./types";
import { storeSafeFixHistoryUpdate } from "./history";

const ALLOWED: Record<SafeFixLifecycleState, SafeFixLifecycleState[]> = {
  PROPOSED: ["READY", "SUPERSEDED"],
  READY: ["APPROVED", "SUPERSEDED"],
  APPROVED: ["APPLIED", "SUPERSEDED"],
  APPLIED: ["VERIFYING", "FAILED"],
  VERIFYING: ["VERIFIED", "FAILED"],
  VERIFIED: [],
  FAILED: ["READY", "SUPERSEDED"],
  SUPERSEDED: [],
};

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
    .maybeSingle();

  const from = (input.fromState ?? (row?.lifecycle_state as SafeFixLifecycleState)) ?? "PROPOSED";
  if (!ALLOWED[from]?.includes(input.toState)) {
    throw new Error(`invalid_transition:${from}->${input.toState}`);
  }

  await storeSafeFixHistoryUpdate(admin, input.safeFixId, { lifecycleState: input.toState });

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
