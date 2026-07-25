import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

export type SideEffectOperation =
  | "production_verdict"
  | "github_commit_status"
  | "in_app_notification"
  | "email_notification"
  | "safe_fix_generation"
  | "automatic_review_finalize";

export function buildIdempotencyKey(input: {
  organizationId: string;
  projectId: string;
  scanId: string;
  commitSha?: string | null;
  operationType: SideEffectOperation;
  suffix?: string;
}): string {
  const material = [
    input.organizationId,
    input.projectId,
    input.scanId,
    input.commitSha ?? "",
    input.operationType,
    input.suffix ?? "",
  ].join(":");
  return createHash("sha256").update(material).digest("hex");
}

export async function hasCompletedSideEffect(
  admin: SupabaseClient,
  idempotencyKey: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("operation_idempotency")
    .select("idempotency_key")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) {
    if (error.message.includes("operation_idempotency")) return false;
    throw new Error(`Could not read idempotency record: ${error.message}`);
  }
  return Boolean(data);
}

export async function recordSideEffect(
  admin: SupabaseClient,
  input: {
    idempotencyKey: string;
    organizationId: string;
    projectId?: string | null;
    scanId?: string | null;
    operationType: SideEffectOperation;
  }
): Promise<{ recorded: boolean; duplicate: boolean }> {
  const { error } = await admin.from("operation_idempotency").insert({
    idempotency_key: input.idempotencyKey,
    organization_id: input.organizationId,
    project_id: input.projectId ?? null,
    scan_id: input.scanId ?? null,
    operation_type: input.operationType,
  });

  if (error) {
    if (error.code === "23505") return { recorded: false, duplicate: true };
    if (error.message.includes("operation_idempotency")) {
      return { recorded: false, duplicate: false };
    }
    throw new Error(`Could not record idempotency key: ${error.message}`);
  }
  return { recorded: true, duplicate: false };
}

export async function runIdempotentSideEffect<T>(
  admin: SupabaseClient,
  input: {
    idempotencyKey: string;
    organizationId: string;
    projectId?: string | null;
    scanId?: string | null;
    operationType: SideEffectOperation;
  },
  execute: () => Promise<T>
): Promise<{ executed: boolean; duplicate: boolean; result?: T }> {
  if (await hasCompletedSideEffect(admin, input.idempotencyKey)) {
    return { executed: false, duplicate: true };
  }

  const result = await execute();
  const recorded = await recordSideEffect(admin, input);
  return { executed: true, duplicate: recorded.duplicate, result };
}
