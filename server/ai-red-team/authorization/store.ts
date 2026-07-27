import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttackAuthorizationRecord } from "./types";

function mapRow(row: Record<string, unknown>): AttackAuthorizationRecord {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    projectId: row.project_id as string,
    targetOrigin: row.target_origin as string,
    environmentType: row.environment_type as AttackAuthorizationRecord["environmentType"],
    status: row.status as AttackAuthorizationRecord["status"],
    authorizationMethod: row.authorization_method as string,
    approvedScope: (row.approved_scope as Record<string, unknown>) ?? {},
    createdBy: (row.created_by as string | null) ?? null,
    approvedAt: row.approved_at as string,
    expiresAt: row.expires_at as string,
    testCredentialsRef: (row.test_credentials_ref as string | null) ?? null,
    pathExclusions: (row.path_exclusions as string[]) ?? [],
    redirectAllowlist: (row.redirect_allowlist as string[]) ?? [],
    maxRequestBudget: row.max_request_budget as number,
    maxDurationSeconds: row.max_duration_seconds as number,
    commitSha: (row.commit_sha as string | null) ?? null,
  };
}

export async function getActiveAttackAuthorization(
  admin: SupabaseClient,
  input: { organizationId: string; projectId: string; targetOrigin: string }
): Promise<AttackAuthorizationRecord | null> {
  const now = new Date().toISOString();
  const { data } = await admin
    .from("attack_authorizations")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("project_id", input.projectId)
    .eq("target_origin", input.targetOrigin)
    .eq("status", "approved")
    .gt("expires_at", now)
    .order("approved_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? mapRow(data as Record<string, unknown>) : null;
}

export async function createAttackAuthorization(
  admin: SupabaseClient,
  input: Omit<AttackAuthorizationRecord, "id"> & { id?: string }
): Promise<AttackAuthorizationRecord> {
  const { data, error } = await admin
    .from("attack_authorizations")
    .insert({
      id: input.id,
      organization_id: input.organizationId,
      project_id: input.projectId,
      target_origin: input.targetOrigin,
      environment_type: input.environmentType,
      status: input.status,
      authorization_method: input.authorizationMethod,
      approved_scope: input.approvedScope,
      created_by: input.createdBy,
      approved_at: input.approvedAt,
      expires_at: input.expiresAt,
      test_credentials_ref: input.testCredentialsRef,
      path_exclusions: input.pathExclusions,
      redirect_allowlist: input.redirectAllowlist,
      max_request_budget: input.maxRequestBudget,
      max_duration_seconds: input.maxDurationSeconds,
      commit_sha: input.commitSha,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`Could not create attack authorization: ${error?.message}`);
  return mapRow(data as Record<string, unknown>);
}
