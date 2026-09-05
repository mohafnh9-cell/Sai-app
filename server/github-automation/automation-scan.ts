import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertOrganizationCanRunScan } from "@/server/billing/assert-scan-access";

export const ACTIVE_AUTOMATION_SCAN_STATUSES = [
  "queued",
  "fetching_repository",
  "indexing",
  "scanning",
  "calculating_score",
] as const;

export async function findActiveIncrementalScanId(
  admin: SupabaseClient,
  input: { repositoryId: string; commitSha: string }
): Promise<string | null> {
  const { data, error } = await admin
    .from("scans")
    .select("id")
    .eq("repository_id", input.repositoryId)
    .eq("commit_sha", input.commitSha)
    .eq("scan_type", "incremental")
    .in("status", [...ACTIVE_AUTOMATION_SCAN_STATUSES])
    .maybeSingle();

  if (error) {
    console.warn("active_incremental_scan_lookup_failed", {
      repositoryId: input.repositoryId,
      commitSha: input.commitSha,
      message: error.message,
    });
    return null;
  }

  return (data?.id as string | undefined) ?? null;
}

export async function createAutomationScan(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    userId: string;
    scanType: "incremental" | "full";
    branch?: string;
    commitSha?: string;
    triggerType?: "webhook" | "scheduled";
  }
): Promise<string | null> {
  // Phase 31.2: scheduled/incremental GitHub automation scans previously
  // created scans with no billing check -- every other scan-creation path
  // already goes through this same gate. No-op today (billing disabled),
  // real free-scan bypass once enabled otherwise.
  try {
    await assertOrganizationCanRunScan(admin, input.organizationId, { id: input.userId });
  } catch {
    console.info("automation_scan_billing_rejected", {
      organizationId: input.organizationId,
      projectId: input.projectId,
    });
    return null;
  }

  const { data: scan, error } = await admin
    .from("scans")
    .insert({
      organization_id: input.organizationId,
      project_id: input.projectId,
      repository_id: input.projectId,
      triggered_by_user_id: input.userId,
      trigger_type: input.triggerType ?? "webhook",
      scan_type: input.scanType,
      status: "queued",
      progress: 0,
      progress_message: "githubQueued",
      branch: input.branch ?? null,
      commit_sha: input.commitSha ?? null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      if (input.scanType === "incremental" && input.commitSha) {
        return findActiveIncrementalScanId(admin, {
          repositoryId: input.projectId,
          commitSha: input.commitSha,
        });
      }
      return null;
    }
    throw new Error(`Could not create automation scan: ${error.message}`);
  }

  await admin.from("repository_scan_state").upsert(
    {
      repository_id: input.projectId,
      organization_id: input.organizationId,
      active_scan_id: scan.id,
    },
    { onConflict: "repository_id" }
  );

  return scan.id as string;
}
