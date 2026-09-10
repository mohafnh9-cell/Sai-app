import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttackChainsSummary } from "./types";

/**
 * Phase 34: reads back the attack_chains rows persisted for this scan by
 * server/ai-red-team/intelligence/persistence.ts, if the unified red-team
 * phase ran for it. Best-effort/read-only -- returns undefined (not thrown)
 * on any failure so a query problem here never breaks the rest of the audit
 * response.
 */
export async function loadAttackChainsSummary(
  admin: SupabaseClient,
  input: { organizationId: string; scanId: string }
): Promise<AttackChainsSummary | undefined> {
  const { data, error } = await admin
    .from("attack_chains")
    .select("title, summary, status")
    .eq("organization_id", input.organizationId)
    .eq("scan_id", input.scanId);

  if (error || !data) return undefined;
  if (data.length === 0) return undefined;

  const confirmedRows = data.filter((row) => row.status === "CONFIRMED");
  return {
    confirmed: confirmedRows.length,
    partiallyValidated: data.filter((row) => row.status === "PARTIALLY_VALIDATED").length,
    potential: data.filter((row) => row.status === "POTENTIAL").length,
    topConfirmed: confirmedRows[0]
      ? { title: confirmedRows[0].title as string, summary: confirmedRows[0].summary as string }
      : null,
  };
}
