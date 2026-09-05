import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { clearInstallationTokenCache } from "./installation-token-service";
import {
  loadInstallationByGithubId,
  loadSoleActiveInstallationByAccountId,
  markInstallationRepositoryRemoved,
  markInstallationRevoked,
  migrateInstallationId,
  upsertGitHubAppInstallation,
  upsertInstallationRepository,
} from "./installation-store";
import {
  fetchGitHubInstallation,
  listInstallationRepositories,
  validateInstallationPermissions,
  verifyRepositoryInInstallation,
} from "./github-api";

type InstallationPayload = {
  action?: string;
  installation?: {
    id?: number;
    account?: { id?: number; login?: string; type?: string };
    repository_selection?: string;
    permissions?: Record<string, string>;
  };
  repositories?: Array<{ id?: number; full_name?: string }>;
  repositories_added?: Array<{ id?: number; full_name?: string }>;
  repositories_removed?: Array<{ id?: number; full_name?: string }>;
  sender?: { id?: number; login?: string };
};

export async function processGitHubAppInstallationEvent(input: {
  admin: SupabaseClient;
  eventType: string;
  payload: Record<string, unknown>;
}): Promise<{ ok: boolean; action: string }> {
  const payload = input.payload as InstallationPayload;
  const githubInstallationId = payload.installation?.id;
  if (!githubInstallationId) {
    return { ok: true, action: "ignored_no_installation" };
  }

  let existing = await loadInstallationByGithubId(input.admin, githubInstallationId);

  // GitHub assigns a fresh installation ID whenever the App is uninstalled
  // and reinstalled on the same account (e.g. while troubleshooting a
  // connection) -- the old ID just starts 404ing, it's never renamed. If we
  // don't already know this installation ID but there's exactly one active
  // row for the same GitHub account, treat this as that installation's ID
  // rotating rather than a brand new, unrelated installation.
  if (!existing && payload.installation?.account?.id) {
    const rotated = await loadSoleActiveInstallationByAccountId(
      input.admin,
      payload.installation.account.id
    );
    if (rotated) {
      await migrateInstallationId(input.admin, {
        installationRowId: rotated.id,
        newGithubInstallationId: githubInstallationId,
        githubAccountLogin: payload.installation.account.login,
        githubAccountType: payload.installation.account.type as "User" | "Organization" | undefined,
        permissionsSnapshot: payload.installation.permissions,
        repositorySelection: payload.installation.repository_selection,
      });
      existing = { ...rotated, github_installation_id: githubInstallationId };
    }
  }

  if (input.eventType === "installation" && payload.action === "created" && existing) {
    for (const repo of payload.repositories ?? []) {
      if (!repo.id) continue;
      await upsertInstallationRepository(input.admin, {
        installationRowId: existing.id,
        organizationId: existing.organization_id,
        githubRepositoryId: repo.id,
        githubFullName: repo.full_name ?? null,
      });
    }
    return { ok: true, action: "installation_migrated" };
  }

  if (input.eventType === "installation" && payload.action === "deleted") {
    if (existing) {
      await markInstallationRevoked(input.admin, {
        installationRowId: existing.id,
        organizationId: existing.organization_id,
      });
      clearInstallationTokenCache(githubInstallationId);
    }
    return { ok: true, action: "installation_revoked" };
  }

  if (input.eventType === "installation" && payload.action === "suspend") {
    if (existing) {
      await input.admin
        .from("github_app_installations")
        .update({ status: "suspended", updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      clearInstallationTokenCache(githubInstallationId);
    }
    return { ok: true, action: "installation_suspended" };
  }

  if (input.eventType === "installation" && payload.action === "unsuspend") {
    if (existing) {
      await input.admin
        .from("github_app_installations")
        .update({ status: "active", updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    }
    return { ok: true, action: "installation_unsuspended" };
  }

  if (
    input.eventType === "installation_repositories" &&
    existing &&
    payload.repositories_removed?.length
  ) {
    for (const repo of payload.repositories_removed) {
      if (!repo.id) continue;
      await markInstallationRepositoryRemoved(input.admin, {
        installationRowId: existing.id,
        organizationId: existing.organization_id,
        githubRepositoryId: repo.id,
      });
    }
    return { ok: true, action: "repositories_removed" };
  }

  if (
    input.eventType === "installation_repositories" &&
    existing &&
    payload.repositories_added?.length
  ) {
    for (const repo of payload.repositories_added) {
      if (!repo.id) continue;
      await upsertInstallationRepository(input.admin, {
        installationRowId: existing.id,
        organizationId: existing.organization_id,
        githubRepositoryId: repo.id,
        githubFullName: repo.full_name ?? null,
      });
    }
    return { ok: true, action: "repositories_added" };
  }

  return { ok: true, action: "ignored" };
}

export async function finalizeGitHubAppInstallation(input: {
  admin: SupabaseClient;
  organizationId: string;
  githubInstallationId: number;
}): Promise<
  | { ok: true; installationRowId: string; repositoryCount: number }
  | { ok: false; code: string; message: string }
> {
  const remote = await fetchGitHubInstallation(input.githubInstallationId);
  if (!remote) {
    return { ok: false, code: "installation_not_found", message: "GitHub installation not found" };
  }
  if (remote.suspended_at) {
    return { ok: false, code: "installation_suspended", message: "GitHub App installation is suspended" };
  }

  const permissionCheck = validateInstallationPermissions(remote.permissions ?? {});
  if (!permissionCheck.ok) {
    return {
      ok: false,
      code: "insufficient_permissions",
      message: `GitHub App is missing permissions: ${permissionCheck.missing.join(", ")}`,
    };
  }

  const { id: installationRowId } = await upsertGitHubAppInstallation(input.admin, {
    organizationId: input.organizationId,
    githubInstallationId: remote.id,
    githubAccountId: remote.account.id,
    githubAccountLogin: remote.account.login,
    githubAccountType: remote.account.type,
    permissionsSnapshot: remote.permissions ?? {},
    repositorySelection: remote.repository_selection,
  });

  // Phase 31.2: listInstallationRepositories now throws on a GitHub API
  // failure instead of silently returning []. The installation row is
  // already persisted above -- don't fail the whole install finalize over a
  // transient repo-listing error; the repos list can be (re)fetched later
  // via GET /api/github/app/repos, which surfaces the failure properly.
  let repos: Awaited<ReturnType<typeof listInstallationRepositories>> = [];
  try {
    repos = await listInstallationRepositories(remote.id);
  } catch (error) {
    console.error("github_app_finalize_repo_sync_failed", {
      installationId: remote.id,
      message: error instanceof Error ? error.message : "unknown",
    });
  }
  for (const repo of repos) {
    await upsertInstallationRepository(input.admin, {
      installationRowId,
      organizationId: input.organizationId,
      githubRepositoryId: repo.id,
      githubFullName: repo.full_name,
    });
  }

  return { ok: true, installationRowId, repositoryCount: repos.length };
}

export async function assertInstallationOwnsRepository(input: {
  admin: SupabaseClient;
  organizationId: string;
  installationRowId: string;
  githubRepositoryId: number;
}): Promise<boolean> {
  const { data: installation } = await input.admin
    .from("github_app_installations")
    .select("id, organization_id, github_installation_id, status, revoked_at")
    .eq("id", input.installationRowId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  if (
    !installation ||
    installation.status !== "active" ||
    installation.revoked_at ||
    installation.organization_id !== input.organizationId
  ) {
    return false;
  }

  const { data: repoRow } = await input.admin
    .from("github_app_installation_repositories")
    .select("id")
    .eq("installation_id", input.installationRowId)
    .eq("organization_id", input.organizationId)
    .eq("github_repository_id", input.githubRepositoryId)
    .is("removed_at", null)
    .maybeSingle();

  if (repoRow?.id) return true;

  return verifyRepositoryInInstallation(
    installation.github_installation_id as number,
    input.githubRepositoryId
  );
}
