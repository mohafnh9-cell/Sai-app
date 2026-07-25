import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProtectionStatusStorage } from "./types";
import { storageFromLabel, type ProtectionStatusLabel } from "./types";

function log(event: string, fields: Record<string, unknown>) {
  console.info({ component: "continuous-protection", event, ...fields });
}

function missingTable(message: string): boolean {
  return message.includes("does not exist");
}

export async function appendCpEvent(
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
    if (missingTable(error.message)) return;
    log("event_append_failed", { type: input.type, error: error.message });
  }
}

export async function recordProtectionStatusChange(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    from: ProtectionStatusStorage | null;
    to: ProtectionStatusStorage;
    ruleIds?: string[];
  }
): Promise<void> {
  if (input.from === input.to) return;
  const day = new Date().toISOString().slice(0, 10);
  await appendCpEvent(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    type: "protection_status_updated",
    idempotencyKey: `status:${day}:${input.from ?? "none"}:${input.to}`,
    payload: {
      from: input.from,
      to: input.to,
      ruleIds: input.ruleIds ?? [],
    },
  });
}

export async function upsertSnapshotStatus(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    status: ProtectionStatusLabel;
    productionConfidence: number | null;
    securityConfidence: number | null;
    healthScore: number | null;
    healthLabel: string;
    worries: string[];
    openCriticalHighCount: number;
  }
): Promise<ProtectionStatusStorage> {
  const storage = storageFromLabel(input.status);
  const snapshotDate = new Date().toISOString().slice(0, 10);

  const { error } = await admin.from("protection_snapshots").upsert(
    {
      organization_id: input.organizationId,
      project_id: input.projectId,
      snapshot_date: snapshotDate,
      production_confidence: input.productionConfidence,
      security_confidence: input.securityConfidence,
      health_score: input.healthScore,
      health_label: input.healthLabel,
      protection_status: storage,
      protection_health: storage === "protected" ? "strong" : storage === "safe_with_caution" ? "steady" : storage === "requires_attention" ? "at_risk" : "unwatched",
      worries_top3: input.worries,
      open_critical_high_count: input.openCriticalHighCount,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id,snapshot_date" }
  );

  if (error && !missingTable(error.message)) {
    log("snapshot_upsert_failed", { projectId: input.projectId, error: error.message });
  }

  return storage;
}
