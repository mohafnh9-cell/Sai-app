import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

export type MergeScanMetricsResult =
  | { ok: true; attempts: number }
  | { ok: false; reason: "scan_not_found" | "update_failed" | "conflict_exhausted" | "not_persisted"; attempts: number; message?: string };

const DEFAULT_ATTEMPTS = 4;

/** jsonb does not keep key order, so equality must not depend on it. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function metricsOf(row: Row | null | undefined): Record<string, unknown> {
  const value = row?.metrics;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Adds keys to `scans.metrics` without losing what other writers put there.
 *
 * `metrics` is one jsonb column written by several writers with read-modify-write (the runner, the evidence marker, the verdict
 * evidence record). A blind `update({ metrics: { ...old, x } })` silently drops whatever another writer stored between the read
 * and the write, and an ignored `{ error }` makes a failed write look like success. So:
 *  - the write is conditional on the row not having changed since it was read (`updated_at` is maintained by a trigger): if
 *    another writer got in first, nothing is written and the merge restarts from the fresh row;
 *  - the database `error` is checked and reported (never swallowed);
 *  - after the write the keys are read back: a write that matched nothing is not reported as done.
 * `patch` may be a function of the current metrics (for "only if absent" rules); returning null writes nothing.
 */
export async function mergeScanMetrics(
  admin: SupabaseClient,
  input: {
    scanId: string;
    organizationId: string;
    patch: Record<string, unknown> | ((current: Record<string, unknown>) => Record<string, unknown> | null);
    attempts?: number;
  }
): Promise<MergeScanMetricsResult> {
  const attempts = Math.max(1, input.attempts ?? DEFAULT_ATTEMPTS);
  let lastMessage: string | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { data: scan, error: readError } = await admin
      .from("scans")
      .select("id, metrics, updated_at")
      .eq("id", input.scanId)
      .eq("organization_id", input.organizationId)
      .maybeSingle();
    if (readError) {
      lastMessage = readError.message;
      continue;
    }
    if (!scan) return { ok: false, reason: "scan_not_found", attempts: attempt };

    // Snapshot right after the read: the condition below must refer to the row AS WE READ IT.
    const stamp = (scan as Row).updated_at;
    const current = { ...metricsOf(scan as Row) };
    const patch = typeof input.patch === "function" ? input.patch(current) : input.patch;
    if (patch === null) return { ok: true, attempts: attempt };

    let query = admin
      .from("scans")
      .update({ metrics: { ...current, ...patch } })
      .eq("id", input.scanId)
      .eq("organization_id", input.organizationId);
    if (typeof stamp === "string") query = query.eq("updated_at", stamp);
    const { data: written, error: writeError } = await query.select("id, metrics").maybeSingle();
    if (writeError) {
      lastMessage = writeError.message;
      continue;
    }
    // Nothing matched: another writer changed the row after we read it. Start over from the fresh row.
    if (!written) continue;
    const stored = metricsOf(written as Row);
    const persisted = Object.keys(patch).every((key) => canonical(stored[key]) === canonical(patch[key]));
    if (persisted) return { ok: true, attempts: attempt };
    lastMessage = "written row does not contain the requested keys";
  }
  return { ok: false, reason: lastMessage ? "update_failed" : "conflict_exhausted", attempts, message: lastMessage };
}
