import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The persistence boundary for `repository_scan_state`, the row every "what
 * is the current verdict for this project?" read is resolved through.
 *
 * Every writer used to upsert this row blindly (last write wins), so a slow
 * older scan finishing after a newer one silently replaced the newer scan's
 * pointer with stale evidence, and a finishing scan cleared a *different*
 * running scan's `active_scan_id`. Nothing but "the code normally finishes in
 * order" prevented it. This module makes the ordering a property of the write:
 *
 *  - The pointer only moves to a scan that was created strictly after the
 *    scan it currently points at (or to the same scan again, idempotently).
 *  - The update itself is a compare-and-swap on `last_scan_id`, so a pointer
 *    that changes between our read and our write is detected (0 rows
 *    updated) and re-evaluated instead of being overwritten.
 *  - A scan of a non-default branch never becomes the project-level pointer:
 *    `can_i_deploy` has no branch parameter, so the current verdict is by
 *    contract the default branch's. Its scan and verdict rows are still
 *    persisted (PR verdicts are read through their own scan link).
 *  - An active-scan marker is only ever cleared by the scan that owns it.
 */

export type ScanStatePointerResult =
  | { applied: true }
  | {
      applied: false;
      reason: "stale_writer" | "non_default_branch" | "scan_not_found" | "contention";
    };

const MAX_CAS_ATTEMPTS = 4;

type ScanOrderRow = {
  id: string;
  created_at: string;
  repository_id: string;
  branch: string | null;
};

function isStrictlyNewer(candidateCreatedAt: string, existingCreatedAt: string): boolean {
  const candidate = Date.parse(candidateCreatedAt);
  const existing = Date.parse(existingCreatedAt);
  if (Number.isNaN(candidate) || Number.isNaN(existing)) return false;
  return candidate > existing;
}

/** Clears `active_scan_id` only if it still belongs to this scan. */
export async function releaseActiveScan(
  admin: SupabaseClient,
  input: { projectId: string; scanId: string }
): Promise<void> {
  const { error } = await admin
    .from("repository_scan_state")
    .update({ active_scan_id: null })
    .eq("repository_id", input.projectId)
    .eq("active_scan_id", input.scanId);
  if (error) throw new Error(`Could not release active scan: ${error.message}`);
}

/**
 * Moves the project's current-scan pointer fields (`last_scan_id`,
 * `current_verdict_id`, `last_security_score`, ...) to `scanId` unless a newer
 * scan already owns them. `values` must not contain `active_scan_id`.
 */
export async function writeScanStatePointer(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    scanId: string;
    values: Record<string, unknown>;
  }
): Promise<ScanStatePointerResult> {
  if ("active_scan_id" in input.values) {
    throw new Error("writeScanStatePointer must not write active_scan_id; use releaseActiveScan");
  }

  const { data: incomingRow } = await admin
    .from("scans")
    .select("id, created_at, repository_id, branch")
    .eq("id", input.scanId)
    .maybeSingle();
  const incoming = (incomingRow ?? null) as ScanOrderRow | null;
  if (!incoming || incoming.repository_id !== input.projectId) {
    return { applied: false, reason: "scan_not_found" };
  }

  const { data: projectRow } = await admin
    .from("projects")
    .select("github_default_branch")
    .eq("id", input.projectId)
    .maybeSingle();
  const defaultBranch = (projectRow?.github_default_branch as string | null | undefined) ?? null;
  if (incoming.branch && defaultBranch && incoming.branch !== defaultBranch) {
    return { applied: false, reason: "non_default_branch" };
  }

  const nextValues = { ...input.values, updated_at: new Date().toISOString() };

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const { data: state, error: stateError } = await admin
      .from("repository_scan_state")
      .select("last_scan_id")
      .eq("repository_id", input.projectId)
      .maybeSingle();
    if (stateError) throw new Error(`Could not read repository scan state: ${stateError.message}`);

    if (!state) {
      const { error: insertError } = await admin.from("repository_scan_state").insert({
        repository_id: input.projectId,
        organization_id: input.organizationId,
        ...nextValues,
      });
      if (!insertError) return { applied: true };
      if (insertError.code !== "23505") {
        throw new Error(`Could not create repository scan state: ${insertError.message}`);
      }
      continue;
    }

    const current = (state.last_scan_id as string | null) ?? null;
    if (current && current !== input.scanId) {
      const { data: currentRow } = await admin
        .from("scans")
        .select("id, created_at")
        .eq("id", current)
        .maybeSingle();
      if (currentRow && !isStrictlyNewer(incoming.created_at, currentRow.created_at as string)) {
        return { applied: false, reason: "stale_writer" };
      }
    }

    const update = admin
      .from("repository_scan_state")
      .update(nextValues)
      .eq("repository_id", input.projectId);
    const guarded = current ? update.eq("last_scan_id", current) : update.is("last_scan_id", null);
    const { data: updated, error: updateError } = await guarded.select("id");
    if (updateError) {
      throw new Error(`Could not update repository scan state: ${updateError.message}`);
    }
    if (updated && updated.length > 0) return { applied: true };
    // The pointer moved between our read and our write: re-evaluate.
  }

  return { applied: false, reason: "contention" };
}
