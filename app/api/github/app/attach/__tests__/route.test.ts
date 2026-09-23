import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/github/app/attach/route";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { getStoredGitHubToken } from "@/lib/github/token-store";
import { isGitHubAppConfigured, getGitHubAppConfig } from "@/server/github-app/config";
import { finalizeGitHubAppInstallation } from "@/server/github-app/installation-events";
import {
  fetchAuthenticatedGitHubUser,
  listInstallationsForGitHubUser,
} from "@/server/github-app/user-installations";
import { assertWorkspaceMembership } from "@/server/workspaces/service";
import { enforceRateLimit } from "@/server/http/rate-limit";

vi.mock("@/lib/auth/dev-bypass", () => ({
  getServerAuthContext: vi.fn(),
}));
vi.mock("@/lib/github/token-store", () => ({
  getStoredGitHubToken: vi.fn(),
}));
vi.mock("@/server/github-app/config", () => ({
  isGitHubAppConfigured: vi.fn(),
  getGitHubAppConfig: vi.fn(),
}));
vi.mock("@/server/github-app/installation-events", () => ({
  finalizeGitHubAppInstallation: vi.fn(),
}));
vi.mock("@/server/workspaces/service", () => ({
  assertWorkspaceMembership: vi.fn(),
}));
vi.mock("@/server/http/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
}));
vi.mock("@/server/security-scanner/admin-client", () => ({
  createAdminClient: vi.fn(() => ({})),
}));

// filterOwnAppInstallations/filterSelfAuthorizedInstallations are pure
// logic worth exercising for real; only the actual network calls
// (listInstallationsForGitHubUser, fetchAuthenticatedGitHubUser) are
// mocked.
vi.mock("@/server/github-app/user-installations", async () => {
  const actual = await vi.importActual<typeof import("@/server/github-app/user-installations")>(
    "@/server/github-app/user-installations"
  );
  return {
    ...actual,
    listInstallationsForGitHubUser: vi.fn(),
    fetchAuthenticatedGitHubUser: vi.fn(),
  };
});

const ORG_SEQURAI = "3635d73b-d1e7-4766-86dd-128529810637";
const ORG_PRUEBA_2 = "03722601-fbd2-4b17-ad79-9321d15834a1";
const USER_ID = "user-c29f41d5";
const APP_ID = "999111";

function authedContext(organizationId = ORG_SEQURAI) {
  return {
    user: { id: USER_ID, email: "user@example.com" },
    supabase: {},
    organizationId,
    orgName: "Sequrai",
    bypass: false,
  } as unknown as Awaited<ReturnType<typeof getServerAuthContext>>;
}

function attachRequest(body: Record<string, unknown> = {}) {
  return new Request("https://app.example.com/api/github/app/attach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function installation(overrides: Partial<{
  id: number;
  app_id: string | number;
  login: string;
  type: "User" | "Organization";
  suspended: boolean;
}> = {}) {
  return {
    id: overrides.id ?? 157921297,
    app_id: Number(overrides.app_id ?? APP_ID),
    account: {
      id: 42,
      login: overrides.login ?? "mohafnh9-cell",
      type: overrides.type ?? "User",
    },
    repository_selection: "all" as const,
    suspended_at: overrides.suspended ? "2026-01-01T00:00:00Z" : null,
  };
}

beforeEach(() => {
  vi.mocked(enforceRateLimit).mockResolvedValue(null);
  vi.mocked(isGitHubAppConfigured).mockReturnValue(true);
  vi.mocked(getGitHubAppConfig).mockReturnValue({
    appId: APP_ID,
    privateKey: "unused-in-these-tests",
    webhookSecret: "unused",
    clientId: null,
    clientSecret: null,
    appSlug: "sequrai",
  });
  vi.mocked(assertWorkspaceMembership).mockResolvedValue(true);
  vi.mocked(getServerAuthContext).mockResolvedValue(authedContext());
  // Matches installation()'s default account (id: 42, login:
  // "mohafnh9-cell") so existing tests exercise the self-owned, authorized
  // path by default. Tests for the authorization gap itself override this.
  vi.mocked(fetchAuthenticatedGitHubUser).mockResolvedValue({ id: 42, login: "mohafnh9-cell" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/github/app/attach", () => {
  // 5. Unauthenticated request → reject
  it("rejects an unauthenticated request", async () => {
    vi.mocked(getServerAuthContext).mockResolvedValue(null);

    const res = await POST(attachRequest());

    expect(res.status).toBe(401);
    expect(finalizeGitHubAppInstallation).not.toHaveBeenCalled();
  });

  // 4. User is not member of current organization → reject
  it("rejects when the user is not a member of the current organization", async () => {
    vi.mocked(assertWorkspaceMembership).mockResolvedValue(false);

    const res = await POST(attachRequest());

    expect(res.status).toBe(403);
    expect(finalizeGitHubAppInstallation).not.toHaveBeenCalled();
  });

  it("rejects when the user has no linked GitHub account (no stored token) -- fails closed, not open", async () => {
    vi.mocked(getStoredGitHubToken).mockResolvedValue(null);

    const res = await POST(attachRequest());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("github_account_not_linked");
    expect(finalizeGitHubAppInstallation).not.toHaveBeenCalled();
  });

  // 8. GitHub API unavailable → safe failure, no database mutation
  it("safely fails with no mutation when GitHub's installations API is unavailable", async () => {
    vi.mocked(getStoredGitHubToken).mockResolvedValue("user-token");
    vi.mocked(listInstallationsForGitHubUser).mockResolvedValue(null);

    const res = await POST(attachRequest());
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.code).toBe("github_api_unavailable");
    expect(finalizeGitHubAppInstallation).not.toHaveBeenCalled();
  });

  it("rejects when GitHub reports zero installations for this account", async () => {
    vi.mocked(getStoredGitHubToken).mockResolvedValue("user-token");
    vi.mocked(listInstallationsForGitHubUser).mockResolvedValue([]);

    const res = await POST(attachRequest());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("no_installation_available");
    expect(finalizeGitHubAppInstallation).not.toHaveBeenCalled();
  });

  // 6. Forged github_installation_id → reject
  it("rejects a forged installationId that does not appear in GitHub's verified list", async () => {
    vi.mocked(getStoredGitHubToken).mockResolvedValue("user-token");
    vi.mocked(listInstallationsForGitHubUser).mockResolvedValue([installation({ id: 157921297 })]);

    const res = await POST(attachRequest({ installationId: 999999999 }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.code).toBe("installation_not_verified");
    expect(finalizeGitHubAppInstallation).not.toHaveBeenCalled();
  });

  // 3. Installation belongs to a different GitHub account → reject
  it("rejects an installation of a different GitHub App (different app_id), even if the ids collide", async () => {
    vi.mocked(getStoredGitHubToken).mockResolvedValue("user-token");
    // Same numeric id, but it's a DIFFERENT app's installation -- app_id
    // does not match this SequrAI App's configured app id.
    vi.mocked(listInstallationsForGitHubUser).mockResolvedValue([
      installation({ id: 157921297, app_id: "1234567" }),
    ]);

    const res = await POST(attachRequest({ installationId: 157921297 }));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("no_installation_available");
    expect(finalizeGitHubAppInstallation).not.toHaveBeenCalled();
  });

  it("excludes suspended installations from candidates", async () => {
    vi.mocked(getStoredGitHubToken).mockResolvedValue("user-token");
    vi.mocked(listInstallationsForGitHubUser).mockResolvedValue([
      installation({ id: 157921297, suspended: true }),
    ]);

    const res = await POST(attachRequest());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("no_installation_available");
  });

  // 11. Multiple installations available → present, do not auto-select
  it("does not auto-select when multiple verified installations are available and none was chosen", async () => {
    vi.mocked(getStoredGitHubToken).mockResolvedValue("user-token");
    vi.mocked(listInstallationsForGitHubUser).mockResolvedValue([
      installation({ id: 111, login: "account-a" }),
      installation({ id: 222, login: "account-b" }),
    ]);

    const res = await POST(attachRequest());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("multiple_installations_available");
    expect(body.installations).toHaveLength(2);
    expect(finalizeGitHubAppInstallation).not.toHaveBeenCalled();
  });

  it("attaches the explicitly chosen installation when multiple are available", async () => {
    vi.mocked(getStoredGitHubToken).mockResolvedValue("user-token");
    vi.mocked(listInstallationsForGitHubUser).mockResolvedValue([
      installation({ id: 111, login: "account-a" }),
      installation({ id: 222, login: "account-b" }),
    ]);
    vi.mocked(finalizeGitHubAppInstallation).mockResolvedValue({
      ok: true,
      installationRowId: "row-2",
      repositoryCount: 1,
    });

    const res = await POST(attachRequest({ installationId: 222 }));

    expect(finalizeGitHubAppInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_SEQURAI, githubInstallationId: 222 })
    );
    expect(res.status).toBe(200);
  });

  // 1. Existing installation attached to a second SequrAI organization
  it("attaches a GitHub-verified installation to the current organization (Sequrai), reusing finalizeGitHubAppInstallation", async () => {
    vi.mocked(getServerAuthContext).mockResolvedValue(authedContext(ORG_SEQURAI));
    vi.mocked(getStoredGitHubToken).mockResolvedValue("user-token");
    vi.mocked(listInstallationsForGitHubUser).mockResolvedValue([installation({ id: 157921297 })]);
    vi.mocked(finalizeGitHubAppInstallation).mockResolvedValue({
      ok: true,
      installationRowId: "row-sequrai",
      repositoryCount: 1,
    });

    const res = await POST(attachRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.installationId).toBe(157921297);
    expect(finalizeGitHubAppInstallation).toHaveBeenCalledWith({
      admin: expect.anything(),
      organizationId: ORG_SEQURAI,
      githubInstallationId: 157921297,
    });
  });

  // 10. Existing "prueba 2" association remains unchanged -- this route
  // never touches any organization other than the caller's own current one.
  it("only ever calls finalizeGitHubAppInstallation with the caller's OWN current organization, never another one", async () => {
    vi.mocked(getServerAuthContext).mockResolvedValue(authedContext(ORG_SEQURAI));
    vi.mocked(getStoredGitHubToken).mockResolvedValue("user-token");
    vi.mocked(listInstallationsForGitHubUser).mockResolvedValue([installation({ id: 157921297 })]);
    vi.mocked(finalizeGitHubAppInstallation).mockResolvedValue({
      ok: true,
      installationRowId: "row-sequrai",
      repositoryCount: 1,
    });

    await POST(attachRequest());

    const call = vi.mocked(finalizeGitHubAppInstallation).mock.calls[0][0];
    expect(call.organizationId).toBe(ORG_SEQURAI);
    expect(call.organizationId).not.toBe(ORG_PRUEBA_2);
  });

  // 2. Already attached to current organization → idempotent success
  it("is idempotent: calling attach again for an installation already attached to this org succeeds without a separate code path", async () => {
    vi.mocked(getStoredGitHubToken).mockResolvedValue("user-token");
    vi.mocked(listInstallationsForGitHubUser).mockResolvedValue([installation({ id: 157921297 })]);
    // finalizeGitHubAppInstallation's own upsert (already covered by its
    // existing tests) is what guarantees no duplicate row -- this route
    // just needs to call it the same way on a repeat request.
    vi.mocked(finalizeGitHubAppInstallation).mockResolvedValue({
      ok: true,
      installationRowId: "row-sequrai",
      repositoryCount: 1,
    });

    const res1 = await POST(attachRequest());
    const res2 = await POST(attachRequest());

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(finalizeGitHubAppInstallation).toHaveBeenCalledTimes(2);
  });

  // 9. finalizeGitHubAppInstallation() fails → no partial/incorrect association
  it("propagates a finalize failure as a typed error without claiming success", async () => {
    vi.mocked(getStoredGitHubToken).mockResolvedValue("user-token");
    vi.mocked(listInstallationsForGitHubUser).mockResolvedValue([installation({ id: 157921297 })]);
    vi.mocked(finalizeGitHubAppInstallation).mockResolvedValue({
      ok: false,
      code: "installation_suspended",
      message: "GitHub App installation is suspended",
    });

    const res = await POST(attachRequest());
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.code).toBe("installation_suspended");
    expect(body.ok).toBeUndefined();
  });

  it("returns 503 when the GitHub App is not configured", async () => {
    vi.mocked(isGitHubAppConfigured).mockReturnValue(false);

    const res = await POST(attachRequest());

    expect(res.status).toBe(503);
    expect(finalizeGitHubAppInstallation).not.toHaveBeenCalled();
  });

  describe("authorization gap: GET /user/installations proves access, not authority", () => {
    // SECURITY: a repository collaborator with mere read/write access to a
    // single repo inside an organization-wide installation would still
    // appear in GET /user/installations for that installation -- this must
    // never be enough to let them attach the org's installation to an
    // unrelated SequrAI organization they happen to also belong to.
    it("rejects an organization-owned installation even though it appears in the verified GitHub list (collaborator scenario)", async () => {
      vi.mocked(getStoredGitHubToken).mockResolvedValue("user-token");
      vi.mocked(fetchAuthenticatedGitHubUser).mockResolvedValue({ id: 42, login: "mohafnh9-cell" });
      vi.mocked(listInstallationsForGitHubUser).mockResolvedValue([
        installation({ id: 555, type: "Organization", login: "some-other-org" }),
      ]);

      const res = await POST(attachRequest());
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.code).toBe("installation_requires_admin_verification");
      expect(finalizeGitHubAppInstallation).not.toHaveBeenCalled();
    });

    it("rejects even an explicitly-chosen organization installationId (client candidate cannot bypass the authorization check)", async () => {
      vi.mocked(getStoredGitHubToken).mockResolvedValue("user-token");
      vi.mocked(fetchAuthenticatedGitHubUser).mockResolvedValue({ id: 42, login: "mohafnh9-cell" });
      vi.mocked(listInstallationsForGitHubUser).mockResolvedValue([
        installation({ id: 555, type: "Organization" }),
      ]);

      const res = await POST(attachRequest({ installationId: 555 }));
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.code).toBe("installation_requires_admin_verification");
      expect(finalizeGitHubAppInstallation).not.toHaveBeenCalled();
    });

    it("rejects a personal (User-type) installation whose account id does not match the caller's own verified GitHub id", async () => {
      vi.mocked(getStoredGitHubToken).mockResolvedValue("user-token");
      // The caller is GitHub user id 42, but this installation's account
      // (still type "User") belongs to a different numeric id -- must
      // never be trusted purely on type === "User".
      vi.mocked(fetchAuthenticatedGitHubUser).mockResolvedValue({ id: 42, login: "mohafnh9-cell" });
      const other = installation({ id: 777, type: "User" });
      other.account.id = 99999;
      vi.mocked(listInstallationsForGitHubUser).mockResolvedValue([other]);

      const res = await POST(attachRequest());
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.code).toBe("installation_requires_admin_verification");
      expect(finalizeGitHubAppInstallation).not.toHaveBeenCalled();
    });

    it("safely fails with no mutation when the caller's own GitHub identity cannot be verified", async () => {
      vi.mocked(getStoredGitHubToken).mockResolvedValue("user-token");
      vi.mocked(fetchAuthenticatedGitHubUser).mockResolvedValue(null);
      vi.mocked(listInstallationsForGitHubUser).mockResolvedValue([installation({ id: 157921297 })]);

      const res = await POST(attachRequest());
      const body = await res.json();

      expect(res.status).toBe(502);
      expect(body.code).toBe("github_api_unavailable");
      expect(finalizeGitHubAppInstallation).not.toHaveBeenCalled();
    });

    it("offers only the self-owned installation and ignores the organization one when both appear in the verified list", async () => {
      vi.mocked(getStoredGitHubToken).mockResolvedValue("user-token");
      vi.mocked(fetchAuthenticatedGitHubUser).mockResolvedValue({ id: 42, login: "mohafnh9-cell" });
      vi.mocked(listInstallationsForGitHubUser).mockResolvedValue([
        installation({ id: 555, type: "Organization" }),
        installation({ id: 157921297, type: "User" }),
      ]);
      vi.mocked(finalizeGitHubAppInstallation).mockResolvedValue({
        ok: true,
        installationRowId: "row-1",
        repositoryCount: 1,
      });

      const res = await POST(attachRequest());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.installationId).toBe(157921297);
      expect(finalizeGitHubAppInstallation).toHaveBeenCalledWith(
        expect.objectContaining({ githubInstallationId: 157921297 })
      );
    });

    // Confirms the real-world scenario this whole feature was built for
    // stays working after the fix: installation 157921297 is genuinely a
    // personal (User-type) installation owned by the account attaching it.
    it("still allows the real production scenario: a personal installation attaching to a second organization", async () => {
      vi.mocked(getStoredGitHubToken).mockResolvedValue("user-token");
      vi.mocked(fetchAuthenticatedGitHubUser).mockResolvedValue({ id: 234916357, login: "mohafnh9-cell" });
      const personalInstallation = installation({ id: 157921297, type: "User" });
      personalInstallation.account.id = 234916357;
      vi.mocked(listInstallationsForGitHubUser).mockResolvedValue([personalInstallation]);
      vi.mocked(finalizeGitHubAppInstallation).mockResolvedValue({
        ok: true,
        installationRowId: "row-sequrai",
        repositoryCount: 1,
      });

      const res = await POST(attachRequest());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.installationId).toBe(157921297);
    });
  });
});
