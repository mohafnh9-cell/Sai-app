import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_REASONING_VERSION, type AiReasoningOverlay } from "./schema";

function log(event: string, fields: Record<string, unknown>) {
  console.info({ component: "ai-finding-reasoning", event, ...fields });
}

/**
 * Cache lookup: a prior COMPLETED reasoning pass for this project with the
 * same evidence hash and version can be reused for a different scan without
 * calling Claude again. Scoped by project_id (never cross-tenant) and by
 * evidence_hash (never reused if the analyzed findings changed).
 */
export async function findCachedReasoning(
  admin: SupabaseClient,
  input: { organizationId: string; projectId: string; evidenceHash: string }
): Promise<{ findings: unknown; attackChains: unknown; model: string | null; tokensUsed: number } | null> {
  const { data, error } = await admin
    .from("ai_finding_reasoning")
    .select("findings, attack_chains, model, tokens_used")
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .eq("evidence_hash", input.evidenceHash)
    .eq("reasoning_version", AI_REASONING_VERSION)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return {
    findings: data.findings,
    attackChains: data.attack_chains,
    model: data.model,
    tokensUsed: Number(data.tokens_used) || 0,
  };
}

/** Upsert-by-scan (scan_id is unique) so a retried Inngest step never creates duplicate rows. */
export async function persistReasoningOverlay(
  admin: SupabaseClient,
  overlay: AiReasoningOverlay
): Promise<void> {
  const { error } = await admin.from("ai_finding_reasoning").upsert(
    {
      organization_id: overlay.organizationId,
      project_id: overlay.projectId,
      scan_id: overlay.scanId,
      status: overlay.status,
      reasoning_version: overlay.version,
      model: overlay.model,
      analyzed_finding_ids: overlay.analyzedFindingIds,
      evidence_hash: overlay.evidenceHash,
      findings: overlay.findings,
      attack_chains: overlay.attackChains,
      failure_reason: overlay.failureReason,
      tokens_used: overlay.tokensUsed,
      duration_ms: overlay.durationMs,
      cache_hit: overlay.cacheHit,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "scan_id" }
  );

  if (error) {
    // Persisting the overlay is itself best-effort -- a failure here must
    // never surface as a scan failure (Phase 30 requirement). The
    // deterministic scan and verdict are already committed by this point.
    log("persist_failed", { scanId: overlay.scanId, error: error.message });
  }
}

/** Tenant-scoped read for the UI/API layer. */
export async function getReasoningOverlayForScan(
  admin: SupabaseClient,
  input: { organizationId: string; scanId: string }
): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin
    .from("ai_finding_reasoning")
    .select(
      "status, reasoning_version, model, analyzed_finding_ids, findings, attack_chains, failure_reason, created_at"
    )
    .eq("organization_id", input.organizationId)
    .eq("scan_id", input.scanId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}
