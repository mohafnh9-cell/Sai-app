import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentProductionVerdict } from "@/server/production-verdict/service";
import { loadProtectionContext } from "@/server/continuous-protection/protection-context";
import { getSafeFixById, storeSafeFixHistoryUpdate } from "./history";
import { transitionSafeFixState } from "./lifecycle";
import { loadVerificationEvidence } from "./verification-evidence";
import { decideFindingVerification } from "./verification-rules";
import { appendSafeFixMemoryEvent } from "./memory-bridge";
import type { SafeFixVerificationResult } from "./types";
import { incrementMetricCounter } from "@/server/observability/metrics";
import { withOperationTiming } from "@/server/observability/operation-timing";

const STATUS_RANK: Record<string, number> = {
  protected: 0,
  safe_with_caution: 1,
  requires_attention: 2,
  not_protected: 3,
};

function rank(value: string | null | undefined): number {
  if (!value) return 99;
  return STATUS_RANK[value] ?? 99;
}

export async function verifySafeFix(
  admin: SupabaseClient,
  input: {
    safeFixId: string;
    organizationId: string;
    projectId: string;
    analysisRunId?: string | null;
    actor?: string;
  }
): Promise<SafeFixVerificationResult> {
  return withOperationTiming(
    "safe_fix.verify",
    () => verifySafeFixInner(admin, input),
    { projectId: input.projectId, safeFixId: input.safeFixId }
  );
}

async function verifySafeFixInner(
  admin: SupabaseClient,
  input: {
    safeFixId: string;
    organizationId: string;
    projectId: string;
    analysisRunId?: string | null;
    actor?: string;
  }
): Promise<SafeFixVerificationResult> {
  const scope = { organizationId: input.organizationId, projectId: input.projectId };
  const record = await getSafeFixById(admin, input.safeFixId, scope);
  if (!record) throw new Error("safe_fix_not_found");

  await transitionSafeFixState(admin, {
    safeFixId: record.id,
    organizationId: input.organizationId,
    projectId: input.projectId,
    toState: "VERIFYING",
    actor: input.actor ?? "system",
    reason: "verification_started",
    relatedRecommendationId: record.recommendationId,
    relatedReviewId: record.reviewId,
  });

  const baseline = record.document;
  const baselineSnap = (await admin
    .from("safe_fix_records")
    .select("baseline_snapshot")
    .eq("id", record.id)
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .maybeSingle())?.data?.baseline_snapshot as Record<string, unknown> | undefined;

  // A proposal bound to a commit is verified against the completed scan of EXACTLY that commit; the
  // latest scan (or any named run) is never substituted for it. A documentary proposal has no commit
  // of its own and keeps the assisted flow: the latest evaluation unless one is named -- never the
  // baseline scan the recommendation was generated from.
  const proposalCommitSha = record.proposalCommitSha;
  const bound = Boolean(proposalCommitSha);
  const currentVerdict = bound
    ? null
    : await getCurrentProductionVerdict(admin, input.organizationId, input.projectId);
  const verificationScanId = bound ? null : input.analysisRunId ?? currentVerdict?.scanId ?? null;

  const evidence = await loadVerificationEvidence(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    baselineScanId: record.reviewId,
    verificationScanId,
    recommendationId: record.recommendationId,
    storedTargets: baselineSnap?.targetFindings,
    proposalCommitSha,
  });

  // The ONLY thing that can produce "passed": the exact target finding(s)
  // absent from a complete, valid rescan of the same project and repository.
  // The scan actually evaluated (resolved by commit for a bound proposal), not the requested id.
  const evaluatedScanId = evidence.verificationScan?.id ?? verificationScanId;
  let decision = decideFindingVerification(evidence);

  // The proposal may have changed while the rescan was being evaluated: a verification of the old
  // content must not approve the new content.
  const latest = await getSafeFixById(admin, record.id, scope);
  if (!latest || (latest.proposalCommitSha ?? null) !== (proposalCommitSha ?? null)) {
    decision = {
      outcome: "partial",
      reasons: [...decision.reasons, "proposal_changed_during_verification"],
      remainingTargetIds: decision.remainingTargetIds,
      targetsAbsent: false,
    };
  }
  const outcome = decision.outcome;
  const binding = bound ? ("exact_proposal_commit" as const) : ("assisted_unbound" as const);

  // Secondary evidence, recorded for context. None of it can cause VERIFIED.
  const verdict = evidence.verdict;
  const ctx = await loadProtectionContext(admin, input.projectId);
  const baselineScore = (baselineSnap?.score as number) ?? null;
  const afterScore = verdict?.score ?? null;
  const productionConfidenceImproved =
    baselineScore != null && afterScore != null ? afterScore > baselineScore : false;

  const beforeStatus = ctx?.latestSnapshotStatus;
  const afterStatus = ctx?.latestSnapshotStatus;
  const protectionStatusImproved = rank(afterStatus) < rank(beforeStatus);

  const baselineBlockers =
    typeof baselineSnap?.blockersCount === "number" ? (baselineSnap.blockersCount as number) : null;
  const newIssuesIntroduced =
    verdict != null && baselineBlockers != null && verdict.blockersCount > baselineBlockers;

  const confidenceDelta =
    baselineScore != null && afterScore != null ? afterScore - baselineScore : null;

  const { data: verificationRow, error } = await admin
    .from("safe_fix_verifications")
    .insert({
      organization_id: input.organizationId,
      project_id: input.projectId,
      safe_fix_id: record.id,
      outcome,
      issue_disappeared: decision.targetsAbsent,
      production_confidence_improved: productionConfidenceImproved,
      protection_status_improved: protectionStatusImproved,
      new_issues_introduced: newIssuesIntroduced,
      production_confidence_before: baselineScore,
      production_confidence_after: afterScore,
      protection_status_before: beforeStatus,
      protection_status_after: afterStatus,
      details: {
        baselinePriorityTitle: (baselineSnap?.priorityTitle as string) ?? "",
        executiveSummary: baseline.executiveSummary,
        reasons: decision.reasons,
        baselineScanId: record.reviewId,
        verificationScanId: evaluatedScanId,
        targetFindingIds: evidence.targets.map((target) => target.findingId),
        remainingTargetIds: decision.remainingTargetIds,
        binding,
        // base = commit of the baseline scan the proposal was generated from;
        // proposal = commit that contains the proposed change (null: documentary, no commit).
        baseCommitSha: evidence.baselineScan?.commitSha ?? null,
        proposalCommitSha: proposalCommitSha ?? null,
        verifiedCommitSha: evidence.verificationScan?.commitSha ?? null,
      },
    })
    .select("id")
    .single();

  if (error) throw error;

  const finalState = outcome === "passed" ? "VERIFIED" : "FAILED";

  await transitionSafeFixState(admin, {
    safeFixId: record.id,
    organizationId: input.organizationId,
    projectId: input.projectId,
    fromState: "VERIFYING",
    toState: finalState,
    actor: input.actor ?? "system",
    reason:
      outcome === "passed"
        ? "verification_passed"
        : `verification_${outcome}:${decision.reasons.join(",")}`,
    relatedRecommendationId: record.recommendationId,
    relatedReviewId: evaluatedScanId ?? record.reviewId,
  });

  await storeSafeFixHistoryUpdate(
    admin,
    record.id,
    {
      confidenceDelta,
      protectionDelta: protectionStatusImproved ? "improved" : "unchanged",
    },
    scope
  );

  const memoryType =
    outcome === "passed" ? "safe_fix_verified" : outcome === "failed" ? "safe_fix_failed" : "safe_fix_applied";

  await appendSafeFixMemoryEvent(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    type: memoryType,
    payload: { safeFixId: record.id, outcome, confidenceDelta, reasons: decision.reasons },
    idempotencyKey: `verify:${record.id}:${outcome}`,
  });

  incrementMetricCounter("verification_completed_total");
  return {
    id: verificationRow.id as string,
    safeFixId: record.id,
    outcome,
    issueDisappeared: decision.targetsAbsent,
    productionConfidenceImproved,
    protectionStatusImproved,
    newIssuesIntroduced,
    binding,
    details: { confidenceDelta, reasons: decision.reasons },
  };
}

export async function approveSafeFix(
  admin: SupabaseClient,
  input: { safeFixId: string; organizationId: string; projectId: string; actor: string }
): Promise<void> {
  await transitionSafeFixState(admin, {
    ...input,
    toState: "APPROVED",
    reason: "founder_approved",
  });
  await appendSafeFixMemoryEvent(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    type: "safe_fix_approved",
    payload: { safeFixId: input.safeFixId },
    idempotencyKey: `approved:${input.safeFixId}`,
  });
}

export async function markSafeFixApplied(
  admin: SupabaseClient,
  input: { safeFixId: string; organizationId: string; projectId: string; actor: string }
): Promise<void> {
  await transitionSafeFixState(admin, {
    ...input,
    toState: "APPLIED",
    reason: "founder_applied",
  });
  await appendSafeFixMemoryEvent(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    type: "safe_fix_applied",
    payload: { safeFixId: input.safeFixId },
    idempotencyKey: `applied:${input.safeFixId}`,
  });
}
