import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SafeFixReportSummary } from "./types";

function log(event: string, fields: Record<string, unknown>) {
  console.info({ component: "safe-fix-engine", event, ...fields });
}

export async function appendSafeFixMemoryEvent(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    type: string;
    payload: Record<string, unknown>;
    idempotencyKey?: string;
  }
): Promise<void> {
  const { error } = await admin.from("protection_events").insert({
    organization_id: input.organizationId,
    project_id: input.projectId,
    type: input.type,
    payload: input.payload,
    idempotency_key: input.idempotencyKey ?? null,
  });
  if (error) {
    if (error.code === "23505") return;
    if (error.message.includes("does not exist")) return;
    log("memory_event_failed", { type: input.type, error: error.message });
  }
}

/** Report integration (Sprint 7) — read by monthly report jobs via API/SQL without editing Sprint 6. */
export async function summarizeSafeFixImpact(
  admin: SupabaseClient,
  projectId: string,
  periodStart: string,
  periodEnd: string
): Promise<SafeFixReportSummary> {
  const startIso = `${periodStart}T00:00:00.000Z`;
  const endIso = `${periodEnd}T23:59:59.999Z`;

  const { data: records } = await admin
    .from("safe_fix_records")
    .select("id, lifecycle_state, document, confidence_delta, created_at")
    .eq("project_id", projectId)
    .gte("created_at", startIso)
    .lte("created_at", endIso);

  const rows = records ?? [];
  const proposed = rows.length;
  const applied = rows.filter((r) =>
    ["APPLIED", "VERIFYING", "VERIFIED"].includes(r.lifecycle_state as string)
  ).length;
  const verified = rows.filter((r) => r.lifecycle_state === "VERIFIED").length;
  const failed = rows.filter((r) => r.lifecycle_state === "FAILED").length;

  const best = rows
    .filter((r) => r.lifecycle_state === "VERIFIED" && r.confidence_delta != null)
    .sort((a, b) => (b.confidence_delta as number) - (a.confidence_delta as number))[0];

  const doc = best?.document as { executiveSummary?: string } | undefined;

  const confidenceGained =
    rows
      .filter((r) => r.confidence_delta != null)
      .reduce((sum, r) => sum + (r.confidence_delta as number), 0) || null;

  return {
    proposed,
    applied,
    verified,
    failed,
    mostImpactfulTitle: doc?.executiveSummary?.slice(0, 120) ?? null,
    confidenceGained,
  };
}
