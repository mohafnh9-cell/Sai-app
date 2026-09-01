import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveGitHubCredential } from "@/server/github-app/credential-provider";

vi.mock("@/server/github-app/config", () => ({
  isGitHubAppConfigured: vi.fn(() => false),
}));

vi.mock("@/server/github/workspace-connection-service", () => ({
  resolveWorkspaceGitHubToken: vi.fn(),
}));

vi.mock("@/server/github-app/installation-token-service", () => ({
  fetchInstallationAccessToken: vi.fn(),
}));

vi.mock("@/server/github-app/installation-store", () => ({
  loadInstallationForOrganization: vi.fn(),
  loadInstallationByGithubId: vi.fn(),
  loadInstallationByRowId: vi.fn(),
  isRepositoryAccessibleViaInstallation: vi.fn(),
}));

vi.mock("@/server/github-app/github-api", () => ({
  verifyRepositoryInInstallation: vi.fn(),
}));

const activeInstallation = {
  id: "inst-row-1",
  organization_id: "org-a",
  github_installation_id: 42,
  github_account_id: 1,
  github_account_login: "acme",
  github_account_type: "Organization" as const,
  status: "active" as const,
  permissions_snapshot: {},
  repository_selection: "selected",
  installed_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  revoked_at: null,
};

function adminWithProject(project: Record<string, unknown> | null) {
  return {
    from(table: string) {
      if (table === "projects") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: project }),
              }),
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
    },
  };
}

describe("resolveGitHubCredential dual mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to OAuth legacy when GitHub App is not configured", async () => {
    const { resolveWorkspaceGitHubToken } = await import(
      "@/server/github/workspace-connection-service"
    );
    vi.mocked(resolveWorkspaceGitHubToken).mockResolvedValue({
      token: "oauth-token",
      userId: "user-1",
      connectionId: "conn-1",
    });

    const result = await resolveGitHubCredential(
      adminWithProject(null) as never,
      "org-a",
      "project-a"
    );
    expect(result?.source).toBe("oauth_legacy");
    expect(result?.token).toBe("oauth-token");
  });

  it("uses GitHub App when project is explicit github_app and token resolves", async () => {
    const { isGitHubAppConfigured } = await import("@/server/github-app/config");
    vi.mocked(isGitHubAppConfigured).mockReturnValue(true);

    const { loadInstallationByRowId, isRepositoryAccessibleViaInstallation } =
      await import("@/server/github-app/installation-store");
    vi.mocked(loadInstallationByRowId).mockResolvedValue(activeInstallation);
    vi.mocked(isRepositoryAccessibleViaInstallation).mockResolvedValue(true);

    const { fetchInstallationAccessToken } = await import(
      "@/server/github-app/installation-token-service"
    );
    vi.mocked(fetchInstallationAccessToken).mockResolvedValue({
      token: "ghs_installation_token",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    const result = await resolveGitHubCredential(
      adminWithProject({
        id: "project-a",
        organization_id: "org-a",
        github_repository_id: 999,
        github_auth_mode: "github_app",
        github_app_installation_id: "inst-row-1",
        connected_by_user_id: "user-1",
      }) as never,
      "org-a",
      "project-a"
    );
    expect(result?.source).toBe("github_app");
    expect(result?.token).toBe("ghs_installation_token");
  });

  it("fail closed when explicit github_app and App token resolution fails", async () => {
    const { isGitHubAppConfigured } = await import("@/server/github-app/config");
    vi.mocked(isGitHubAppConfigured).mockReturnValue(true);

    const { loadInstallationByRowId } = await import("@/server/github-app/installation-store");
    vi.mocked(loadInstallationByRowId).mockResolvedValue(null);

    const { resolveWorkspaceGitHubToken } = await import(
      "@/server/github/workspace-connection-service"
    );

    const result = await resolveGitHubCredential(
      adminWithProject({
        id: "project-a",
        organization_id: "org-a",
        github_repository_id: 999,
        github_auth_mode: "github_app",
        github_app_installation_id: "inst-row-1",
        connected_by_user_id: "user-1",
      }) as never,
      "org-a",
      "project-a"
    );

    expect(result).toBeNull();
    expect(resolveWorkspaceGitHubToken).not.toHaveBeenCalled();
  });

  it("uses OAuth legacy when project is explicit oauth_legacy even if App is configured", async () => {
    const { isGitHubAppConfigured } = await import("@/server/github-app/config");
    vi.mocked(isGitHubAppConfigured).mockReturnValue(true);

    const { fetchInstallationAccessToken } = await import(
      "@/server/github-app/installation-token-service"
    );
    const { resolveWorkspaceGitHubToken } = await import(
      "@/server/github/workspace-connection-service"
    );
    vi.mocked(resolveWorkspaceGitHubToken).mockResolvedValue({
      token: "oauth-token",
      userId: "user-1",
      connectionId: "conn-1",
    });

    const result = await resolveGitHubCredential(
      adminWithProject({
        id: "project-a",
        organization_id: "org-a",
        github_repository_id: 999,
        github_auth_mode: "oauth_legacy",
        github_app_installation_id: null,
        connected_by_user_id: "user-1",
      }) as never,
      "org-a",
      "project-a"
    );

    expect(result?.source).toBe("oauth_legacy");
    expect(result?.token).toBe("oauth-token");
    expect(fetchInstallationAccessToken).not.toHaveBeenCalled();
  });

  it("prefers GitHub App when auth mode unset and App is configured", async () => {
    const { isGitHubAppConfigured } = await import("@/server/github-app/config");
    vi.mocked(isGitHubAppConfigured).mockReturnValue(true);

    const { loadInstallationForOrganization, isRepositoryAccessibleViaInstallation } =
      await import("@/server/github-app/installation-store");
    vi.mocked(loadInstallationForOrganization).mockResolvedValue(activeInstallation);
    vi.mocked(isRepositoryAccessibleViaInstallation).mockResolvedValue(true);

    const { fetchInstallationAccessToken } = await import(
      "@/server/github-app/installation-token-service"
    );
    vi.mocked(fetchInstallationAccessToken).mockResolvedValue({
      token: "ghs_installation_token",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    const result = await resolveGitHubCredential(
      adminWithProject({
        id: "project-a",
        organization_id: "org-a",
        github_repository_id: 999,
        github_auth_mode: null,
        github_app_installation_id: null,
        connected_by_user_id: "user-1",
      }) as never,
      "org-a",
      "project-a"
    );

    expect(result?.source).toBe("github_app");
  });

  it("rejects App credential when installation belongs to another organization", async () => {
    const { isGitHubAppConfigured } = await import("@/server/github-app/config");
    vi.mocked(isGitHubAppConfigured).mockReturnValue(true);

    const { loadInstallationByRowId } = await import("@/server/github-app/installation-store");
    vi.mocked(loadInstallationByRowId).mockResolvedValue({
      ...activeInstallation,
      organization_id: "org-b",
    });

    const { resolveWorkspaceGitHubToken } = await import(
      "@/server/github/workspace-connection-service"
    );

    const result = await resolveGitHubCredential(
      adminWithProject({
        id: "project-a",
        organization_id: "org-a",
        github_repository_id: 999,
        github_auth_mode: "github_app",
        github_app_installation_id: "inst-row-1",
        connected_by_user_id: "user-1",
      }) as never,
      "org-a",
      "project-a"
    );

    expect(result).toBeNull();
    expect(resolveWorkspaceGitHubToken).not.toHaveBeenCalled();
  });

  it("rejects App credential when installation is revoked", async () => {
    const { isGitHubAppConfigured } = await import("@/server/github-app/config");
    vi.mocked(isGitHubAppConfigured).mockReturnValue(true);

    const { loadInstallationByRowId } = await import("@/server/github-app/installation-store");
    vi.mocked(loadInstallationByRowId).mockResolvedValue({
      ...activeInstallation,
      status: "revoked",
      revoked_at: new Date().toISOString(),
    });

    const result = await resolveGitHubCredential(
      adminWithProject({
        id: "project-a",
        organization_id: "org-a",
        github_repository_id: 999,
        github_auth_mode: "github_app",
        github_app_installation_id: "inst-row-1",
        connected_by_user_id: "user-1",
      }) as never,
      "org-a",
      "project-a"
    );

    expect(result).toBeNull();
  });

  it("rejects App credential when repository is not owned by installation", async () => {
    const { isGitHubAppConfigured } = await import("@/server/github-app/config");
    vi.mocked(isGitHubAppConfigured).mockReturnValue(true);

    const { loadInstallationByRowId, isRepositoryAccessibleViaInstallation } =
      await import("@/server/github-app/installation-store");
    vi.mocked(loadInstallationByRowId).mockResolvedValue(activeInstallation);
    vi.mocked(isRepositoryAccessibleViaInstallation).mockResolvedValue(false);

    const { verifyRepositoryInInstallation } = await import("@/server/github-app/github-api");
    vi.mocked(verifyRepositoryInInstallation).mockResolvedValue(false);

    const result = await resolveGitHubCredential(
      adminWithProject({
        id: "project-a",
        organization_id: "org-a",
        github_repository_id: 999,
        github_auth_mode: "github_app",
        github_app_installation_id: "inst-row-1",
        connected_by_user_id: "user-1",
      }) as never,
      "org-a",
      "project-a"
    );

    expect(result).toBeNull();
  });

  // M3 (audit): the token itself must be scoped to the repository it's
  // actually for, not just app-side-checked against it -- these assert the
  // real request sent to fetchInstallationAccessToken, not just the final
  // authorization outcome (already covered above).
  describe("M3 — installation token scoping", () => {
    it("scopes the token to the project's own repository when known", async () => {
      const { isGitHubAppConfigured } = await import("@/server/github-app/config");
      vi.mocked(isGitHubAppConfigured).mockReturnValue(true);

      const { loadInstallationByRowId, isRepositoryAccessibleViaInstallation } =
        await import("@/server/github-app/installation-store");
      vi.mocked(loadInstallationByRowId).mockResolvedValue(activeInstallation);
      vi.mocked(isRepositoryAccessibleViaInstallation).mockResolvedValue(true);

      const { fetchInstallationAccessToken } = await import(
        "@/server/github-app/installation-token-service"
      );
      vi.mocked(fetchInstallationAccessToken).mockResolvedValue({
        token: "ghs_scoped",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });

      await resolveGitHubCredential(
        adminWithProject({
          id: "project-a",
          organization_id: "org-a",
          github_repository_id: 999,
          github_auth_mode: "github_app",
          github_app_installation_id: "inst-row-1",
          connected_by_user_id: "user-1",
        }) as never,
        "org-a",
        "project-a"
      );

      expect(fetchInstallationAccessToken).toHaveBeenCalledWith(42, {
        repositoryIds: [999],
      });
    });

    it("scopes the token to the caller's repositoryIdsHint when no project exists yet", async () => {
      const { isGitHubAppConfigured } = await import("@/server/github-app/config");
      vi.mocked(isGitHubAppConfigured).mockReturnValue(true);

      const { loadInstallationForOrganization } = await import(
        "@/server/github-app/installation-store"
      );
      vi.mocked(loadInstallationForOrganization).mockResolvedValue(activeInstallation);

      const { fetchInstallationAccessToken } = await import(
        "@/server/github-app/installation-token-service"
      );
      vi.mocked(fetchInstallationAccessToken).mockResolvedValue({
        token: "ghs_hint_scoped",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });

      // No projectId -- mirrors app/api/github/connect/route.ts verifying
      // freshly-selected repos before the project row exists.
      await resolveGitHubCredential(adminWithProject(null) as never, "org-a", undefined, {
        repositoryIdsHint: [111, 222],
      });

      expect(fetchInstallationAccessToken).toHaveBeenCalledWith(42, {
        repositoryIds: [111, 222],
      });
    });

    it("requests an installation-wide token only when neither a project repo nor a hint is available", async () => {
      const { isGitHubAppConfigured } = await import("@/server/github-app/config");
      vi.mocked(isGitHubAppConfigured).mockReturnValue(true);

      const { loadInstallationForOrganization } = await import(
        "@/server/github-app/installation-store"
      );
      vi.mocked(loadInstallationForOrganization).mockResolvedValue(activeInstallation);

      const { fetchInstallationAccessToken } = await import(
        "@/server/github-app/installation-token-service"
      );
      vi.mocked(fetchInstallationAccessToken).mockResolvedValue({
        token: "ghs_unscoped",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });

      await resolveGitHubCredential(adminWithProject(null) as never, "org-a");

      expect(fetchInstallationAccessToken).toHaveBeenCalledWith(42, {
        repositoryIds: undefined,
      });
    });
  });
});
