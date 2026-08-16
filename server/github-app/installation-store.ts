import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GitHubAppInstallationStatus } from "@/server/github/github-auth-mode";

export type GitHubAppInstallationRow = {
  id: string;
  organization_id: string;
  github_installation_id: number;
  github_account_id: number;
  github_account_login: string;
  github_account_type: "User" | "Organization";
  status: GitHubAppInstallationStatus;
  permissions_snapshot: Record<string, string>;
  repository_selection: string | null;
  installed_at: string;
  updated_at: string;
  revoked_at: string | null;
};

export async function loadInstallationForOrganization(
  admin: SupabaseClient,
  organizationId: string
): Promise<GitHubAppInstallationRow | null> {
  const { data } = await admin
    .from("github_app_installations")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .is("revoked_at", null)
    .order("installed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as GitHubAppInstallationRow | null) ?? null;
}

export async function loadInstallationByRowId(
  admin: SupabaseClient,
  input: { installationRowId: string; organizationId: string }
): Promise<GitHubAppInstallationRow | null> {
  const { data } = await admin
    .from("github_app_installations")
    .select("*")
    .eq("id", input.installationRowId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  return (data as GitHubAppInstallationRow | null) ?? null;
}

export async function loadInstallationByGithubId(
  admin: SupabaseClient,
  githubInstallationId: number
): Promise<GitHubAppInstallationRow | null> {
  const { data } = await admin
    .from("github_app_installations")
    .select("*")
    .eq("github_installation_id", githubInstallationId)
    .maybeSingle();

  return (data as GitHubAppInstallationRow | null) ?? null;
}

export async function upsertGitHubAppInstallation(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    githubInstallationId: number;
    githubAccountId: number;
    githubAccountLogin: string;
    githubAccountType: "User" | "Organization";
    permissionsSnapshot: Record<string, string>;
    repositorySelection: string | null;
  }
): Promise<{ id: string }> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("github_app_installations")
    .upsert(
      {
        organization_id: input.organizationId,
        github_installation_id: input.githubInstallationId,
        github_account_id: input.githubAccountId,
        github_account_login: input.githubAccountLogin,
        github_account_type: input.githubAccountType,
        permissions_snapshot: input.permissionsSnapshot,
        repository_selection: input.repositorySelection,
        status: "active",
        revoked_at: null,
        installed_at: now,
        updated_at: now,
      },
      { onConflict: "organization_id,github_installation_id" }
    )
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(error?.message ?? "Could not save GitHub App installation");
  }

  await admin
    .from("workspace_github_connections")
    .update({ github_auth_mode: "github_app", updated_at: now })
    .eq("organization_id", input.organizationId);

  return { id: data.id as string };
}

export async function markInstallationRevoked(
  admin: SupabaseClient,
  input: { installationRowId: string; organizationId: string }
): Promise<void> {
  const now = new Date().toISOString();
  await admin
    .from("github_app_installations")
    .update({ status: "revoked", revoked_at: now, updated_at: now })
    .eq("id", input.installationRowId)
    .eq("organization_id", input.organizationId);

  await admin
    .from("projects")
    .update({ github_auth_mode: "oauth_legacy", github_app_installation_id: null })
    .eq("github_app_installation_id", input.installationRowId)
    .eq("organization_id", input.organizationId);
}

export async function upsertInstallationRepository(
  admin: SupabaseClient,
  input: {
    installationRowId: string;
    organizationId: string;
    githubRepositoryId: number;
    githubFullName: string | null;
  }
): Promise<void> {
  const now = new Date().toISOString();
  await admin.from("github_app_installation_repositories").upsert(
    {
      installation_id: input.installationRowId,
      organization_id: input.organizationId,
      github_repository_id: input.githubRepositoryId,
      github_full_name: input.githubFullName,
      added_at: now,
      removed_at: null,
    },
    { onConflict: "installation_id,github_repository_id" }
  );
}

export async function markInstallationRepositoryRemoved(
  admin: SupabaseClient,
  input: {
    installationRowId: string;
    organizationId: string;
    githubRepositoryId: number;
  }
): Promise<void> {
  const now = new Date().toISOString();
  await admin
    .from("github_app_installation_repositories")
    .update({ removed_at: now })
    .eq("installation_id", input.installationRowId)
    .eq("organization_id", input.organizationId)
    .eq("github_repository_id", input.githubRepositoryId);

  await admin
    .from("projects")
    .update({
      webhook_enabled: false,
      github_auth_mode: "oauth_legacy",
      github_app_installation_id: null,
    })
    .eq("organization_id", input.organizationId)
    .eq("github_repository_id", input.githubRepositoryId)
    .eq("github_app_installation_id", input.installationRowId);
}

export async function isRepositoryAccessibleViaInstallation(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    installationRowId: string;
    githubRepositoryId: number;
  }
): Promise<boolean> {
  const { data } = await admin
    .from("github_app_installation_repositories")
    .select("id")
    .eq("installation_id", input.installationRowId)
    .eq("organization_id", input.organizationId)
    .eq("github_repository_id", input.githubRepositoryId)
    .is("removed_at", null)
    .maybeSingle();

  return Boolean(data?.id);
}
