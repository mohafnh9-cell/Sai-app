import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveWorkspaceGitHubToken } from "@/server/github/workspace-connection-service";
import { isGitHubAppConfigured } from "./config";
import { fetchInstallationAccessToken } from "./installation-token-service";
import {
  isRepositoryAccessibleViaInstallation,
  loadInstallationByGithubId,
  loadInstallationByRowId,
  loadInstallationForOrganization,
} from "./installation-store";
import { verifyRepositoryInInstallation } from "./github-api";

export type GitHubCredentialSource = "github_app" | "oauth_legacy";

export type GitHubCredential = {
  token: string;
  userId: string;
  source: GitHubCredentialSource;
  connectionId: string | null;
  githubInstallationId: number | null;
};

type ProjectAuthRow = {
  id: string;
  organization_id: string;
  github_repository_id: number | null;
  github_auth_mode: string | null;
  github_app_installation_id: string | null;
  connected_by_user_id: string | null;
};

async function loadProjectAuthRow(
  admin: SupabaseClient,
  projectId: string,
  organizationId: string
): Promise<ProjectAuthRow | null> {
  const { data } = await admin
    .from("projects")
    .select(
      "id, organization_id, github_repository_id, github_auth_mode, github_app_installation_id, connected_by_user_id"
    )
    .eq("id", projectId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  return (data as ProjectAuthRow | null) ?? null;
}

/**
 * Explicit oauth_legacy → never GitHub App.
 * Explicit github_app → always try App (fail closed on failure).
 * Unset → prefer App when configured or project has installation binding.
 */
function shouldPreferGitHubApp(project: ProjectAuthRow | null): boolean {
  if (project?.github_auth_mode === "oauth_legacy") return false;
  if (project?.github_auth_mode === "github_app") return true;
  if (project?.github_app_installation_id != null) return true;
  return isGitHubAppConfigured();
}

async function resolveGitHubAppCredential(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    project?: ProjectAuthRow | null;
    installationRowId?: string | null;
    githubInstallationId?: number | null;
  }
): Promise<GitHubCredential | null> {
  if (!isGitHubAppConfigured()) return null;

  let installation =
    input.installationRowId != null
      ? await loadInstallationByRowId(admin, {
          installationRowId: input.installationRowId,
          organizationId: input.organizationId,
        })
      : null;

  if (!installation && input.githubInstallationId != null) {
    installation = await loadInstallationByGithubId(admin, input.githubInstallationId);
  }

  if (!installation) {
    installation = await loadInstallationForOrganization(admin, input.organizationId);
  }

  if (
    !installation ||
    installation.organization_id !== input.organizationId ||
    installation.status !== "active" ||
    installation.revoked_at
  ) {
    return null;
  }

  const githubRepositoryId = input.project?.github_repository_id ?? null;
  if (githubRepositoryId != null) {
    const inDb = await isRepositoryAccessibleViaInstallation(admin, {
      organizationId: input.organizationId,
      installationRowId: installation.id,
      githubRepositoryId,
    });
    if (!inDb) {
      const verified = await verifyRepositoryInInstallation(
        installation.github_installation_id,
        githubRepositoryId
      );
      if (!verified) return null;
    }
  }

  const access = await fetchInstallationAccessToken(installation.github_installation_id);
  if (!access) return null;

  return {
    token: access.token,
    userId: input.project?.connected_by_user_id ?? "github-app",
    source: "github_app",
    connectionId: null,
    githubInstallationId: installation.github_installation_id,
  };
}

/**
 * Unified GitHub credential resolution.
 * Prefers GitHub App installation tokens when configured and authorized; falls back to OAuth legacy.
 */
export async function resolveGitHubCredential(
  admin: SupabaseClient,
  organizationId: string,
  projectId?: string
): Promise<GitHubCredential | null> {
  const project = projectId
    ? await loadProjectAuthRow(admin, projectId, organizationId)
    : null;

  const preferApp = shouldPreferGitHubApp(project);

  if (preferApp) {
    const appCredential = await resolveGitHubAppCredential(admin, {
      organizationId,
      project,
      installationRowId: project?.github_app_installation_id,
    });
    if (appCredential) {
      console.info({
        component: "github-credential",
        event: "resolved",
        source: "github_app",
        organizationId,
        projectId: projectId ?? null,
      });
      return appCredential;
    }
    if (project?.github_auth_mode === "github_app") {
      return null;
    }
  }

  const oauth = await resolveWorkspaceGitHubToken(admin, organizationId, projectId);
  if (!oauth) return null;

  console.info({
    component: "github-credential",
    event: "resolved",
    source: "oauth_legacy",
    organizationId,
    projectId: projectId ?? null,
  });

  return {
    token: oauth.token,
    userId: oauth.userId,
    source: "oauth_legacy",
    connectionId: oauth.connectionId,
    githubInstallationId: null,
  };
}
