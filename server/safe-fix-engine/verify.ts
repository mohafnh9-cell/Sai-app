import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentProductionVerdict } from "@/server/production-verdict/service";
import { loadProtectionContext } from "@/server/continuous-protection/protection-context";
import { getSafeFixById, storeSafeFixHistoryUpdate } from "./history";
import { transitionSafeFixState } from "./lifecycle";
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
    actor?: string;
  }
): Promise<SafeFixVerificationResult> {
  const record = await getSafeFixById(admin, input.safeFixId);
  if (!record || record.projectId !== input.projectId) {
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

  const verdict = await getCurrentProductionVerdict(admin, input.projectId);
  const ctx = await loadProtectionContext(admin, input.projectId);

  const baselineScore = (baselineSnap?.score as number) ?? null;
  const afterScore = verdict?.score ?? ctx.productionConfidence;
  const productionConfidenceImproved =
    baselineScore != null && afterScore != null ? afterScore > baselineScore : false;

  const beforeStatus = ctx.latestSnapshotStatus;
  const afterStatus = ctx.latestSnapshotStatus;
  const protectionStatusImproved = rank(afterStatus) < rank(beforeStatus);

  const baselineBlockers = (baselineSnap?.blockersCount as number) ?? 999;
  const issueDisappeared = verdict ? verdict.blockersCount < baselineBlockers : false;

  const baselinePriorityTitle = (baselineSnap?.priorityTitle as string) ?? "";
  const stillInPriorities = verdict?.topPriorities.some((p) => p.title === baselinePriorityTitle) ?? true;
  const issueGone = !stillInPriorities || issueDisappeared;

  const newIssuesIntroduced =
    verdict != null && verdict.blockersCount > baselineBlockers && !issueGone;

  let outcome: "passed" | "failed" | "partial" = "partial";
  if (issueGone && productionConfidenceImproved && !newIssuesIntroduced) outcome = "passed";
  else if (newIssuesIntroduced) outcome = "failed";

  const confidenceDelta =
    baselineScore != null && afterScore != null ? afterScore - baselineScore : null;

  const { data: verificationRow, error } = await admin
    .from("safe_fix_verifications")
    .insert({
      organization_id: input.organizationId,
      project_id: input.projectId,
      safe_fix_id: record.id,
      outcome,
      issue_disappeared: issueGone,
      production_confidence_improved: productionConfidenceImproved,
      protection_status_improved: protectionStatusImproved,
      new_issues_introduced: newIssuesIntroduced,
      production_confidence_before: baselineScore,
      production_confidence_after: afterScore,
      protection_status_before: beforeStatus,
      protection_status_after: afterStatus,
      details: {
        baselinePriorityTitle,
        executiveSummary: baseline.executiveSummary,
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
    reason: `verification_${outcome}`,
    relatedRecommendationId: record.recommendationId,
    relatedReviewId: record.reviewId,
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
    payload: { safeFixId: record.id, outcome, confidenceDelta },
    idempotencyKey: `verify:${record.id}:${outcome}`,
  });

  incrementMetricCounter("verification_completed_total");
  return {
    id: verificationRow.id as string,
    safeFixId: record.id,
    outcome,
    issueDisappeared: issueGone,
    productionConfidenceImproved,
    protectionStatusImproved,
    newIssuesIntroduced,
    details: { confidenceDelta },
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
