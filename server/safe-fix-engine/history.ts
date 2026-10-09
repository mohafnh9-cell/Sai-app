import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  SafeFixDocumentV2,
  SafeFixLifecycleState,
  SafeFixPrDraft,
  SafeFixRecord,
  SafeFixScope,
} from "./types";

const OPEN_STATES: SafeFixLifecycleState[] = [
  "PROPOSED",
  "READY",
  "APPROVED",
  "APPLIED",
  "VERIFYING",
];

export function mapSafeFixRow(row: Record<string, unknown>): SafeFixRecord {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    projectId: row.project_id as string,
    recommendationId: row.recommendation_id as string,
    reviewId: (row.review_id as string) ?? null,
    verdictId: (row.verdict_id as string) ?? null,
    lifecycleState: row.lifecycle_state as SafeFixRecord["lifecycleState"],
    confidenceBand: row.confidence_band as SafeFixRecord["confidenceBand"],
    confidenceScore: row.confidence_score as number,
    document: row.document as SafeFixDocumentV2,
    prDraft: row.pr_draft as SafeFixPrDraft,
    // Records created before migration 067 have no column value: documentary, unbound.
    proposalCommitSha: (row.proposal_commit_sha as string | null | undefined) ?? null,
    confidenceDelta: (row.confidence_delta as number) ?? null,
    protectionDelta: (row.protection_delta as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function persistGeneratedSafeFix(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    recommendationId: string;
    reviewId: string;
    verdictId: string | null;
    confidenceBand: SafeFixRecord["confidenceBand"];
    confidenceScore: number;
    document: SafeFixDocumentV2;
    prDraft: SafeFixPrDraft;
    baseline: Record<string, unknown>;
  }
): Promise<SafeFixRecord> {
  const { data, error } = await admin
    .from("safe_fix_records")
    .insert({
      organization_id: input.organizationId,
      project_id: input.projectId,
      recommendation_id: input.recommendationId,
      review_id: input.reviewId,
      verdict_id: input.verdictId,
      lifecycle_state: "PROPOSED",
      confidence_band: input.confidenceBand,
      confidence_score: input.confidenceScore,
      document: input.document,
      pr_draft: input.prDraft,
      baseline_snapshot: input.baseline,
    })
    .select("*")
    .single();

  if (error) throw error;
  return mapSafeFixRow(data);
}

export async function supersedeOpenFixesForRecommendation(
  admin: SupabaseClient,
  scope: SafeFixScope,
  recommendationId: string
): Promise<void> {
  const { data: rows } = await admin
    .from("safe_fix_records")
    .select("id")
    .eq("organization_id", scope.organizationId)
    .eq("project_id", scope.projectId)
    .eq("recommendation_id", recommendationId)
    .in("lifecycle_state", OPEN_STATES);

  for (const row of rows ?? []) {
    await admin
      .from("safe_fix_records")
      .update({ lifecycle_state: "SUPERSEDED", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("organization_id", scope.organizationId)
      .eq("project_id", scope.projectId);
  }
}

export async function listSafeFixHistory(
  admin: SupabaseClient,
  scope: SafeFixScope,
  limit = 30
): Promise<SafeFixRecord[]> {
  const { data } = await admin
    .from("safe_fix_records")
    .select("*")
    .eq("organization_id", scope.organizationId)
    .eq("project_id", scope.projectId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map(mapSafeFixRow);
}

/**
 * Loads a Safe Fix inside an explicit organization + project scope. The service-role client bypasses
 * RLS, so the scope is part of the query: a record of another organization or project is "not found".
 */
export async function getSafeFixById(
  admin: SupabaseClient,
  safeFixId: string,
  scope: SafeFixScope
): Promise<SafeFixRecord | null> {
  const { data } = await admin
    .from("safe_fix_records")
    .select("*")
    .eq("id", safeFixId)
    .eq("organization_id", scope.organizationId)
    .eq("project_id", scope.projectId)
    .maybeSingle();
  return data ? mapSafeFixRow(data) : null;
}

export async function storeSafeFixHistoryUpdate(
  admin: SupabaseClient,
  safeFixId: string,
  patch: Partial<{
    lifecycleState: SafeFixLifecycleState;
    confidenceDelta: number | null;
    protectionDelta: string | null;
  }>,
  scope: SafeFixScope
): Promise<void> {
  const { data, error } = await admin
    .from("safe_fix_records")
    .update({
      ...(patch.lifecycleState ? { lifecycle_state: patch.lifecycleState } : {}),
      ...(patch.confidenceDelta !== undefined ? { confidence_delta: patch.confidenceDelta } : {}),
      ...(patch.protectionDelta !== undefined ? { protection_delta: patch.protectionDelta } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", safeFixId)
    .eq("organization_id", scope.organizationId)
    .eq("project_id", scope.projectId)
    .select("id");
  if (error) throw error;
  // Zero rows = not this scope's record: never a silent success.
  if (!data || data.length === 0) throw new Error("safe_fix_not_found");
}
