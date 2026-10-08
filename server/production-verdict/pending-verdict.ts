import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { findPreviousCompletedScan } from "@/server/security-scanner/previous-scan";

export const VERDICT_MATERIALIZATION_WINDOW_MS = 120_000;

/**
 * True while a completed scan may still be materializing its verdict.
 * Terminal outcomes end it: a verdict exists (caller never asks), the scan did
 * not complete (failed / cancelled / still running -> not "materializing"), or
 * the window elapsed (the verdict is genuinely missing: stop, do not poll forever).
 */
export function isVerdictMaterializing(
  scan: { status?: string | null; completed_at?: string | null } | null | undefined,
  now: number = Date.now()
): boolean {
  if (!scan || scan.status !== "completed" || !scan.completed_at) return false;
  const completedAt = Date.parse(scan.completed_at);
  if (!Number.isFinite(completedAt)) return false;
  const age = now - completedAt;
  return age < VERDICT_MATERIALIZATION_WINDOW_MS && age > -VERDICT_MATERIALIZATION_WINDOW_MS;
}


/**
 * True when the project's most recent completed default-branch scan is NOT the scan the
 * current persisted verdict belongs to AND is still inside the materialization window.
 *
 * A scan flips to "completed" (and releases `active_scan_id`) before its verdict is written, so
 * for that gap `getCurrentProductionVerdict` still returns the PREVIOUS scan's verdict. That
 * verdict must not be presented as the current decision. Bounded by the same window as
 * `isVerdictMaterializing`: after it, the verdict is genuinely missing and nothing polls forever.
 */
export async function newerScanAwaitingVerdict(
  admin: SupabaseClient,
  projectId: string,
  currentVerdictScanId: string | null | undefined
): Promise<boolean> {
  if (!currentVerdictScanId) return false;
  const latest = (await findPreviousCompletedScan(
    admin,
    { projectId, branch: null, excludeScanId: "" },
    "id, status, completed_at"
  ).catch(() => null)) as { id?: string; status?: string; completed_at?: string } | null;
  if (!latest?.id || latest.id === currentVerdictScanId) return false;
  return isVerdictMaterializing(latest);
}
