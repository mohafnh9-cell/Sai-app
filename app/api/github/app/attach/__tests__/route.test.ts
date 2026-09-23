import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/github/app/attach/route";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { isGitHubAppConfigured } from "@/server/github-app/config";
import { finalizeGitHubAppInstallation } from "@/server/github-app/installation-events";
import {
  discoverVerifiedInstallationsForUser,
  resolveGitHubProviderId,
  verifyInstallationOwnership,
} from "@/server/github-app/installation-authorization";
import { assertWorkspaceMembership } from "@/server/workspaces/service";
import { enforceRateLimit } from "@/server/http/rate-limit";

vi.mock("@/lib/auth/dev-bypass", () => ({ getServerAuthContext: vi.fn() }));
vi.mock("@/server/github-app/config", () => ({ isGitHubAppConfigured: vi.fn() }));
vi.mock("@/server/github-app/installation-events", () => ({ finalizeGitHubAppInstallation: vi.fn() }));
vi.mock("@/server/github-app/installation-authorization", () => ({
  discoverVerifiedInstallationsForUser: vi.fn(),
  resolveGitHubProviderId: vi.fn(),
  verifyInstallationOwnership: vi.fn(),
}));
vi.mock("@/server/workspaces/service", () => ({ assertWorkspaceMembership: vi.fn() }));
vi.mock("@/server/http/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/server/security-scanner/admin-client", () => ({ createAdminClient: vi.fn(() => ({})) }));

const ORG_SEQURAI = "3635d73b-d1e7-4766-86dd-128529810637";
const ORG_PRUEBA_2 = "03722601-fbd2-4b17-ad79-9321d15834a1";
const USER_ID = "user-c29f41d5";
const PROVIDER_ID = 234916357;

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

function verified(overrides: Partial<{ id: number; login: string }> = {}) {
  return {
    githubInstallationId: overrides.id ?? 157921297,
    accountId: PROVIDER_ID,
    accountLogin: overrides.login ?? "mohafnh9-cell",
  };
}

beforeEach(() => {
  vi.mocked(enforceRateLimit).mockResolvedValue(null);
  vi.mocked(isGitHubAppConfigured).mockReturnValue(true);
  vi.mocked(assertWorkspaceMembership).mockResolvedValue(true);
  vi.mocked(getServerAuthContext).mockResolvedValue(authedContext());
  vi.mocked(resolveGitHubProviderId).mockResolvedValue(PROVIDER_ID);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/github/app/attach", () => {
  // 12. unauthenticated -> reject
  it("rejects an unauthenticated request", async () => {
    vi.mocked(getServerAuthContext).mockResolvedValue(null);

    const res = await POST(attachRequest());

    expect(res.status).toBe(401);
    expect(finalizeGitHubAppInstallation).not.toHaveBeenCalled();
  });

  // 11. not a member of the current org -> reject
  it("rejects when the user is not a member of the current organization", async () => {
    vi.mocked(assertWorkspaceMembership).mockResolvedValue(false);

    const res = await POST(attachRequest());

    expect(res.status).toBe(403);
    expect(finalizeGitHubAppInstallation).not.toHaveBeenCalled();
  });

  // 4. missing GitHub identity -> safe failure
  it("safely fails when the user has no verified GitHub identity", async () => {
    vi.mocked(resolveGitHubProviderId).mockResolvedValue(null);

    const res = await POST(attachRequest());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("github_identity_not_linked");
    expect(finalizeGitHubAppInstallation).not.toHaveBeenCalled();
  });

  // 18. no verified candidate -> clear "no existing installation" state
  it("returns a clear no-installation state when discovery finds nothing", async () => {
    vi.mocked(discoverVerifiedInstallationsForUser).mockResolvedValue([]);

    const res = await POST(attachRequest());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("no_installation_available");
    expect(finalizeGitHubAppInstallation).not.toHaveBeenCalled();
  });

  // 17. multiple verified candidates require explicit selection
  it("does not auto-select when multiple verified candidates exist and none was chosen", async () => {
    vi.mocked(discoverVerifiedInstallationsForUser).mockResolvedValue([
      verified({ id: 111, login: "account-a" }),
      verified({ id: 222, login: "account-b" }),
    ]);

    const res = await POST(attachRequest());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("multiple_installations_available");
    expect(body.installations).toHaveLength(2);
    expect(finalizeGitHubAppInstallation).not.toHaveBeenCalled();
  });

  // 9. forged candidate installationId -> reject (independently re-verified, not found)
  it("rejects a client-supplied installationId that fails live re-verification", async () => {
    vi.mocked(verifyInstallationOwnership).mockResolvedValue(null);

    const res = await POST(attachRequest({ installationId: 999999999 }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.code).toBe("installation_not_verified");
    expect(finalizeGitHubAppInstallation).not.toHaveBeenCalled();
    expect(verifyInstallationOwnership).toHaveBeenCalledWith(999999999, PROVIDER_ID);
  });

  it("uses discovery (not the client) when exactly one verified candidate exists and none was selected", async () => {
    vi.mocked(discoverVerifiedInstallationsForUser).mockResolvedValue([verified({ id: 157921297 })]);
    vi.mocked(finalizeGitHubAppInstallation).mockResolvedValue({
      ok: true,
      installationRowId: "row-1",
      repositoryCount: 1,
    });

    const res = await POST(attachRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.installationId).toBe(157921297);
  });

  it("attaches the explicitly chosen, independently re-verified installation when multiple are available", async () => {
    vi.mocked(verifyInstallationOwnership).mockResolvedValue(verified({ id: 222, login: "account-b" }));
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

  // 14. successful Sequrai attach creates second organization association
  it("attaches the verified installation to the current organization (Sequrai)", async () => {
    vi.mocked(getServerAuthContext).mockResolvedValue(authedContext(ORG_SEQURAI));
    vi.mocked(discoverVerifiedInstallationsForUser).mockResolvedValue([verified({ id: 157921297 })]);
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

  // 13. existing prueba 2 association remains unchanged -- this route never
  // touches any organization other than the caller's own current one.
  it("only ever calls finalizeGitHubAppInstallation with the caller's OWN current organization, never another one", async () => {
    vi.mocked(getServerAuthContext).mockResolvedValue(authedContext(ORG_SEQURAI));
    vi.mocked(discoverVerifiedInstallationsForUser).mockResolvedValue([verified({ id: 157921297 })]);
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

  // 15. repeated attach is idempotent
  it("is idempotent: repeated attach calls both succeed without a separate code path", async () => {
    vi.mocked(discoverVerifiedInstallationsForUser).mockResolvedValue([verified({ id: 157921297 })]);
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

  it("propagates a finalize failure as a typed error without claiming success", async () => {
    vi.mocked(discoverVerifiedInstallationsForUser).mockResolvedValue([verified({ id: 157921297 })]);
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
});
