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
  const record = await getSafeFixById(admin, input.safeFixId);
  if (
    !record ||
    record.projectId !== input.projectId ||
    record.organizationId !== input.organizationId
  ) {
    throw new Error("safe_fix_not_found");
  }

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
    .maybeSingle())?.data?.baseline_snapshot as Record<string, unknown> | undefined;

  // The verification scan is the latest evaluation unless one is named -- never
  // the baseline scan the recommendation was generated from.
  const currentVerdict = await getCurrentProductionVerdict(
    admin,
    input.organizationId,
    input.projectId
  );
  const verificationScanId = input.analysisRunId ?? currentVerdict?.scanId ?? null;

  const evidence = await loadVerificationEvidence(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    baselineScanId: record.reviewId,
    verificationScanId,
    recommendationId: record.recommendationId,
    storedTargets: baselineSnap?.targetFindings,
  });

  // The ONLY thing that can produce "passed": the exact target finding(s)
  // absent from a complete, valid rescan of the same project and repository.
  const decision = decideFindingVerification(evidence);
  const outcome = decision.outcome;

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
        verificationScanId,
        targetFindingIds: evidence.targets.map((target) => target.findingId),
        remainingTargetIds: decision.remainingTargetIds,
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
    relatedReviewId: verificationScanId ?? record.reviewId,
  });

  await storeSafeFixHistoryUpdate(admin, record.id, {
    confidenceDelta,
    protectionDelta: protectionStatusImproved ? "improved" : "unchanged",
  });

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
