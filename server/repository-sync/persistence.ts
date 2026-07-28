import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedPushDetection, RepositorySyncErrorCode } from "@/brain/repository-sync";

export async function touchWebhookLastDelivery(
  admin: SupabaseClient,
  projectId: string
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin
    .from("github_webhooks")
    .update({ last_delivery_at: now, updated_at: now })
    .eq("project_id", projectId);

  if (error) {
    console.warn("github_webhook_last_delivery_update_failed", {
      projectId,
      message: error.message,
    });
  }
}

export async function initializeRepositorySyncStatus(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    githubRepositoryId: number;
  }
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin.from("repository_sync_status").upsert(
    {
      project_id: input.projectId,
      organization_id: input.organizationId,
      github_repository_id: input.githubRepositoryId,
      connection_status: "connected",
      last_error: null,
      updated_at: now,
    },
    { onConflict: "project_id" }
  );

  if (error) {
    console.warn("repository_sync_status_init_failed", {
      projectId: input.projectId,
      message: error.message,
    });
  }
}

/**
 * GitHub does not guarantee webhook deliveries arrive in push order — retries
 * and network jitter can deliver an older push after a newer one has already
 * been recorded. Without a defense here, that reorder would regress
 * `latestDetectedCommitSha` back to an older commit, which downstream
 * staleness comparisons treat as ground truth. Guard using the push's own
 * event timestamp (`pushedAt`), which is the best ordering signal available
 * without fetching commit ancestry from GitHub.
 */
export async function recordLiveHeadCommit(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    githubRepositoryId: number | null;
    commitSha: string;
    branch: string;
    commitMessage?: string | null;
  }
): Promise<void> {
  const detectedAt = new Date().toISOString();
  const { error } = await admin.from("repository_sync_status").upsert(
    {
      project_id: input.projectId,
      organization_id: input.organizationId,
      github_repository_id: input.githubRepositoryId,
      connection_status: "connected",
      branch: input.branch,
      commit_sha: input.commitSha,
      commit_message: input.commitMessage ?? "Live GitHub HEAD",
      pushed_at: detectedAt,
      detected_at: detectedAt,
      last_error: null,
      updated_at: detectedAt,
    },
    { onConflict: "project_id" }
  );

  if (error) {
    console.warn("repository_sync_live_head_failed", {
      projectId: input.projectId,
      message: error.message,
    });
  }
}

export async function recordPushDetection(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    githubRepositoryId: number | null;
    detection: ParsedPushDetection;
  }
): Promise<void> {
  const { data: existing } = await admin
    .from("repository_sync_status")
    .select("pushed_at, commit_sha")
    .eq("project_id", input.projectId)
    .maybeSingle();

  if (existing?.pushed_at && existing.commit_sha) {
    const existingPushedAt = new Date(existing.pushed_at as string).getTime();
    const incomingPushedAt = new Date(input.detection.pushedAt).getTime();
    if (
      Number.isFinite(existingPushedAt) &&
      Number.isFinite(incomingPushedAt) &&
      incomingPushedAt < existingPushedAt
    ) {
      console.info("repository_sync_push_detection_out_of_order_ignored", {
        projectId: input.projectId,
        incomingCommitSha: input.detection.commitSha,
        currentCommitSha: existing.commit_sha,
      });
      return;
    }
  }

  const detectedAt = new Date().toISOString();
  const { error } = await admin.from("repository_sync_status").upsert(
    {
      project_id: input.projectId,
      organization_id: input.organizationId,
      github_repository_id: input.githubRepositoryId,
      connection_status: "connected",
      branch: input.detection.branch,
      commit_sha: input.detection.commitSha,
      commit_message: input.detection.commitMessage,
      pushed_at: input.detection.pushedAt,
      detected_at: detectedAt,
      last_error: null,
      updated_at: detectedAt,
    },
    { onConflict: "project_id" }
  );

  if (error) {
    console.warn("repository_sync_push_detection_failed", {
      projectId: input.projectId,
      message: error.message,
    });
  }
}

export async function markRepositorySyncError(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    githubRepositoryId?: number | null;
    errorCode: RepositorySyncErrorCode;
  }
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin.from("repository_sync_status").upsert(
    {
      project_id: input.projectId,
      organization_id: input.organizationId,
      github_repository_id: input.githubRepositoryId ?? null,
      connection_status: "connection_issue",
      last_error: input.errorCode,
      updated_at: now,
    },
    { onConflict: "project_id" }
  );

  if (error) {
    console.warn("repository_sync_status_error_update_failed", {
      projectId: input.projectId,
      message: error.message,
    });
  }
}

export async function markRepositoryDisconnected(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
  }
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin.from("repository_sync_status").upsert(
    {
      project_id: input.projectId,
      organization_id: input.organizationId,
      connection_status: "disconnected",
      last_error: "repository_disconnected",
      updated_at: now,
    },
    { onConflict: "project_id" }
  );

  if (error) {
    console.warn("repository_sync_status_disconnect_failed", {
      projectId: input.projectId,
      message: error.message,
    });
  }
}
