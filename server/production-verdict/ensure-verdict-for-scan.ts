import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { finalizeVerdictWhenEvidenceComplete, type FinalizeMode } from "./evidence-finalization";

/**
 * Every completed scan must have exactly one production_verdict row.
 * Called at scan-job completion and when the runner was skipped.
 */
export async function ensureProductionVerdictForCompletedScan(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    scanId: string;
    scanJobId?: string | null;
    /** "recovery" generates from whatever evidence exists (orphaned scan jobs only). */
    mode?: FinalizeMode;
  }
): Promise<{ productionVerdictId: string | null; deferred?: boolean }> {
  const { data: scan, error: scanError } = await admin
    .from("scans")
    .select("id, status")
    .eq("id", input.scanId)
    .eq("project_id", input.projectId)
    .maybeSingle();

  if (scanError || !scan) {
    throw new Error(`Scan not found for verdict ensure: ${input.scanId}`);
  }

  if (String(scan.status) !== "completed") {
    throw new Error(
      `Cannot ensure verdict for non-completed scan ${input.scanId} (status=${scan.status})`
    );
  }

  // Generation goes through the evidence-aware finalizer: a verdict written
  // while engine jobs are still running would be frozen as insufficient_data
  // (a completed scan's verdict is immutable). The engine job that completes
  // last -- or the runner, if it finishes last -- generates it instead.
  const outcome = await finalizeVerdictWhenEvidenceComplete(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId: input.scanId,
    scanJobId: input.scanJobId ?? null,
    mode: input.mode ?? "pipeline",
  });
  if (outcome.status === "deferred") {
    return { productionVerdictId: null, deferred: true };
  }

  const { data: verdictRow, error: verdictError } = await admin
    .from("production_verdicts")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("scan_id", input.scanId)
    .maybeSingle();

  if (verdictError || !verdictRow?.id) {
    throw new Error(
      `VERDICT_MISSING_FOR_COMPLETED_SCAN: scan=${input.scanId} project=${input.projectId}`
    );
  }

  return { productionVerdictId: verdictRow.id as string };
}
