import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RedTeamRunRecord, RedTeamRunStatus, RedTeamRunStore } from "./red-team-run-store";

function mapRow(row: Record<string, unknown>): RedTeamRunRecord {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    projectId: row.project_id as string,
    authorizationId: (row.authorization_id as string | null) ?? null,
    idempotencyKey: (row.idempotency_key as string | null) ?? null,
    status: row.status as RedTeamRunStatus,
    commitSha: (row.commit_sha as string | null) ?? null,
    targetOrigin: (row.target_origin as string | null) ?? null,
    environmentType: (row.environment_type as string | null) ?? null,
    discoveryReportId: (row.discovery_report_id as string | null) ?? null,
    executionLeaseToken: (row.execution_lease_token as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

const ACTIVE_STATUSES: RedTeamRunStatus[] = [
  "requested",
  "authorization_check",
  "queued",
  "provisioning",
  "exploring",
  "testing",
  "validating",
];

export function createSupabaseRedTeamRunStore(admin: SupabaseClient): RedTeamRunStore {
  return {
    async create(input) {
      const now = new Date().toISOString();
      const { data, error } = await admin
        .from("red_team_runs")
        .insert({
          id: input.id,
          organization_id: input.organizationId,
          project_id: input.projectId,
          authorization_id: input.authorizationId,
          idempotency_key: input.idempotencyKey,
          status: input.status,
          commit_sha: input.commitSha,
          target_origin: input.targetOrigin,
          environment_type: input.environmentType,
          discovery_report_id: input.discoveryReportId,
          execution_lease_token: input.executionLeaseToken,
          metadata: input.metadata,
          created_at: now,
          updated_at: now,
        })
        .select("*")
        .single();
      if (error || !data) throw new Error(`red_team_runs insert failed: ${error?.message}`);
      return mapRow(data as Record<string, unknown>);
    },

    async updateStatus(id, status, patch) {
      const { data, error } = await admin
        .from("red_team_runs")
        .update({
          status,
          authorization_id: patch?.authorizationId,
          discovery_report_id: patch?.discoveryReportId,
          execution_lease_token: patch?.executionLeaseToken,
          metadata: patch?.metadata,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select("*")
        .single();
      if (error || !data) throw new Error(`red_team_runs update failed: ${error?.message}`);
      return mapRow(data as Record<string, unknown>);
    },

    async getById(id) {
      const { data } = await admin.from("red_team_runs").select("*").eq("id", id).maybeSingle();
      return data ? mapRow(data as Record<string, unknown>) : null;
    },

    async findActiveByIdempotency(projectId, idempotencyKey) {
      const { data } = await admin
        .from("red_team_runs")
        .select("*")
        .eq("project_id", projectId)
        .eq("idempotency_key", idempotencyKey)
        .in("status", ACTIVE_STATUSES)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ? mapRow(data as Record<string, unknown>) : null;
    },
  };
}
