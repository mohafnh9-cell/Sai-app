import "server-only";

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppendProtectionEventInput } from "./types";

function log(event: string, fields: Record<string, unknown>) {
  console.info({ component: "production-memory", event, ...fields });
}

function isMissingMemoryTable(message: string): boolean {
  return message.includes("protection_events") && message.includes("does not exist");
}

/** Append-only protection event with optional idempotency per project. */
export async function appendProtectionEvent(
  admin: SupabaseClient,
  input: AppendProtectionEventInput
): Promise<{ id: string } | null> {
  const row = {
    organization_id: input.organizationId,
    project_id: input.projectId,
    type: input.type,
    payload: input.payload,
    occurred_at: input.occurredAt ?? new Date().toISOString(),
    scan_id: input.scanId ?? null,
    scan_job_id: input.scanJobId ?? null,
    idempotency_key: input.idempotencyKey ?? null,
  };

  const { data, error } = await admin
    .from("protection_events")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505" && input.idempotencyKey) {
      return null;
    }
    if (isMissingMemoryTable(error.message)) {
      log("migration_missing", { projectId: input.projectId });
      return null;
    }
    log("append_failed", { projectId: input.projectId, type: input.type, error: error.message });
    return null;
  }

  return data;
}

export function snapshotContentHash(fields: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex").slice(0, 32);
}

export async function ensureProjectMemoryProfile(
  admin: SupabaseClient,
  organizationId: string,
  projectId: string
): Promise<void> {
  const { data: project } = await admin
    .from("projects")
    .select("created_at")
    .eq("id", projectId)
    .maybeSingle();

  const { error } = await admin.from("project_memory_profile").upsert(
    {
      project_id: projectId,
      organization_id: organizationId,
      project_created_at: project?.created_at ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id", ignoreDuplicates: true }
  );

  if (error && !isMissingMemoryTable(error.message)) {
    log("profile_ensure_failed", { projectId, error: error.message });
  }
}
