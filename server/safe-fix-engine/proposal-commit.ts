import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSafeFixById } from "./history";
import { PROPOSAL_CHANGED_REASON, transitionSafeFixState } from "./lifecycle";
import type { SafeFixLifecycleState, SafeFixScope } from "./types";

const FULL_SHA = /^[0-9a-f]{40}$/i;

/** States in which the proposal's commit must not move: a verification or an applied claim is in flight. */
const LOCKED: ReadonlySet<SafeFixLifecycleState> = new Set(["APPLIED", "VERIFYING", "SUPERSEDED"]);

/** States whose approval/verification described the previous content and must be reopened on change. */
const REOPEN: ReadonlySet<SafeFixLifecycleState> = new Set(["APPROVED", "VERIFIED", "FAILED"]);

/**
 * Records the commit that contains the proposed change. Only a real change has a commit: nothing
 * calls this for the current documentary proposals, and no SHA is ever invented for them.
 *
 * When the commit changes after an approval or verification, that approval/verification no longer
 * describes the current content: the record is reopened to READY (reason `proposal_commit_changed`)
 * BEFORE the new SHA is stored, so a crash between the two steps leaves the safe state ("not verified").
 */
export async function setSafeFixProposalCommit(
  admin: SupabaseClient,
  input: { safeFixId: string; scope: SafeFixScope; commitSha: string; actor: string }
): Promise<{ changed: boolean; state: SafeFixLifecycleState }> {
  if (!FULL_SHA.test(input.commitSha)) throw new Error("invalid_commit_sha");
  const next = input.commitSha.toLowerCase();

  const record = await getSafeFixById(admin, input.safeFixId, input.scope);
  if (!record) throw new Error("safe_fix_not_found");

  const current = record.proposalCommitSha?.toLowerCase() ?? null;
  if (current === next) return { changed: false, state: record.lifecycleState };
  if (LOCKED.has(record.lifecycleState)) throw new Error("proposal_commit_locked");

  // The base commit is the commit of the baseline scan the proposal was generated from; a proposal
  // commit equal to it contains no change.
  if (record.reviewId) {
    const { data: base } = await admin
      .from("scans")
      .select("commit_sha")
      .eq("id", record.reviewId)
      .eq("organization_id", input.scope.organizationId)
      .eq("project_id", input.scope.projectId)
      .maybeSingle();
    if (base?.commit_sha && String(base.commit_sha).toLowerCase() === next) {
      throw new Error("proposal_commit_is_base_commit");
    }
  }

  let state = record.lifecycleState;
  if (REOPEN.has(state)) {
    await transitionSafeFixState(admin, {
      safeFixId: record.id,
      organizationId: input.scope.organizationId,
      projectId: input.scope.projectId,
      toState: "READY",
      actor: input.actor,
      reason: `${PROPOSAL_CHANGED_REASON}:${current ?? "none"}->${next}`,
      relatedRecommendationId: record.recommendationId,
      relatedReviewId: record.reviewId,
    });
    state = "READY";
  }

  let update = admin
    .from("safe_fix_records")
    .update({ proposal_commit_sha: next, updated_at: new Date().toISOString() })
    .eq("id", record.id)
    .eq("organization_id", input.scope.organizationId)
    .eq("project_id", input.scope.projectId);
  update = current === null ? update.is("proposal_commit_sha", null) : update.eq("proposal_commit_sha", current);
  const { data, error } = await update.select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("proposal_commit_conflict");

  return { changed: true, state };
}
