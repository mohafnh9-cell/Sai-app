import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateAndPersistProductionVerdict,
  getProductionVerdictByScan,
} from "./core";

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
  }
): Promise<{ productionVerdictId: string }> {
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

  let existing = await getProductionVerdictByScan(admin, input.organizationId, input.scanId);
  if (existing) {
    const { data: row } = await admin
      .from("production_verdicts")
      .select("id")
      .eq("organization_id", input.organizationId)
      .eq("scan_id", input.scanId)
      .maybeSingle();
    if (row?.id) {
      return { productionVerdictId: row.id as string };
    }
  }

  await generateAndPersistProductionVerdict(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId: input.scanId,
    scanJobId: input.scanJobId ?? null,
  });

  const { data: verdictRow, error: verdictError } = await admin
    .from("production_verdicts")
    .select("id")
    .eq("scan_id", input.scanId)
    .maybeSingle();

  if (verdictError || !verdictRow?.id) {
    throw new Error(
      `VERDICT_MISSING_FOR_COMPLETED_SCAN: scan=${input.scanId} project=${input.projectId}`
    );
  }

  return { productionVerdictId: verdictRow.id as string };
}
