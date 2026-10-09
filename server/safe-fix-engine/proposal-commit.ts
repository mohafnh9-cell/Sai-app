import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSafeFixById } from "./history";
import { PROPOSAL_CHANGED_REASON, transitionSafeFixState } from "./lifecycle";
import type { SafeFixLifecycleState, SafeFixScope } from "./types";

const FULL_SHA = /^[0-9a-f]{40}$/i;

/**
 * Migration 067 adds `proposal_commit_sha`. Reading records with `select("*")` works with or without it
 * (absent = unbound), but WRITING the column does not: PostgREST answers 42703 / PGRST204. Detect that
 * explicitly so the caller gets a clear, side-effect-free refusal instead of a half-applied change.
 */
export function isMissingProposalCommitColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    (typeof error.message === "string" && error.message.includes("proposal_commit_sha"))
  );
}

async function assertProposalCommitColumn(admin: SupabaseClient, scope: SafeFixScope): Promise<void> {
  const { error } = await admin
    .from("safe_fix_records")
    .select("proposal_commit_sha")
    .eq("organization_id", scope.organizationId)
    .eq("project_id", scope.projectId)
    .limit(1);
  if (isMissingProposalCommitColumn(error)) throw new Error("proposal_commit_unsupported");
  if (error) throw error;
}

/** States in which the proposal's commit must not move: a verification or an applied claim is in flight. */
const LOCKED: ReadonlySet<SafeFixLifecycleState> = new Set(["APPLIED", "VERIFYING", "SUPERSEDED"]);

/**
 * Whether recording `next` over `current` invalidates the state the record is in. A first commit on an
 * APPROVED record (current === null) is the customer reporting WHERE the approved instructions were
 * applied, not a change of the approved content, so the approval stands. A VERIFIED record was verified
 * without a commit binding (assisted), so binding a commit later reopens it. FAILED is reopened to retry.
 */
function reopens(state: SafeFixLifecycleState, current: string | null): boolean {
  if (state === "VERIFIED" || state === "FAILED") return true;
  return state === "APPROVED" && current !== null;
}

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

  await assertProposalCommitColumn(admin, input.scope);

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
  if (reopens(state, current)) {
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
  if (isMissingProposalCommitColumn(error)) throw new Error("proposal_commit_unsupported");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("proposal_commit_conflict");

  return { changed: true, state };
}
