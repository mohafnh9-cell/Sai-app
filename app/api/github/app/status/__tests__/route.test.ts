import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/github/app/status/route";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { getStoredGitHubToken } from "@/lib/github/token-store";
import { getGitHubAppConfig, isGitHubAppConfigured } from "@/server/github-app/config";
import { loadInstallationForOrganization } from "@/server/github-app/installation-store";
import {
  fetchAuthenticatedGitHubUser,
  listInstallationsForGitHubUser,
} from "@/server/github-app/user-installations";
import { assertWorkspaceMembership } from "@/server/workspaces/service";
import { enforceRateLimit } from "@/server/http/rate-limit";

vi.mock("@/lib/auth/dev-bypass", () => ({ getServerAuthContext: vi.fn() }));
vi.mock("@/lib/github/token-store", () => ({ getStoredGitHubToken: vi.fn() }));
vi.mock("@/server/github-app/config", () => ({
  isGitHubAppConfigured: vi.fn(),
  getGitHubAppConfig: vi.fn(),
}));
vi.mock("@/server/github-app/installation-store", () => ({
  loadInstallationForOrganization: vi.fn(),
}));
vi.mock("@/server/workspaces/service", () => ({ assertWorkspaceMembership: vi.fn() }));
vi.mock("@/server/http/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/server/security-scanner/admin-client", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/server/github-app/user-installations", async () => {
  const actual = await vi.importActual<typeof import("@/server/github-app/user-installations")>(
    "@/server/github-app/user-installations"
  );
  return { ...actual, listInstallationsForGitHubUser: vi.fn(), fetchAuthenticatedGitHubUser: vi.fn() };
});

const ORG = "org-under-test";
const APP_ID = "999111";

function request() {
  return new Request("https://app.example.com/api/github/app/status");
}

beforeEach(() => {
  vi.mocked(enforceRateLimit).mockResolvedValue(null);
  vi.mocked(isGitHubAppConfigured).mockReturnValue(true);
  vi.mocked(getGitHubAppConfig).mockReturnValue({
    appId: APP_ID,
    privateKey: "unused",
    webhookSecret: "unused",
    clientId: null,
    clientSecret: null,
    appSlug: "sequrai",
  });
  vi.mocked(assertWorkspaceMembership).mockResolvedValue(true);
  vi.mocked(getServerAuthContext).mockResolvedValue({
    user: { id: "user-1" },
    supabase: {},
    organizationId: ORG,
    orgName: "Org",
    bypass: false,
  } as unknown as Awaited<ReturnType<typeof getServerAuthContext>>);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/github/app/status", () => {
  // 12. no installation, no available installation either
  it("reports no installation and no available installations when nothing exists anywhere", async () => {
    vi.mocked(loadInstallationForOrganization).mockResolvedValue(null);
    vi.mocked(getStoredGitHubToken).mockResolvedValue(null);

    const res = await GET(request());
    const body = await res.json();

    expect(body.installation).toBeNull();
    expect(body.availableInstallations).toEqual([]);
  });

  // 12. existing installation available (not yet attached to this org)
  it("surfaces a verified, unattached, self-owned installation as available when this org has none", async () => {
    vi.mocked(loadInstallationForOrganization).mockResolvedValue(null);
    vi.mocked(getStoredGitHubToken).mockResolvedValue("user-token");
    vi.mocked(fetchAuthenticatedGitHubUser).mockResolvedValue({ id: 1, login: "mohafnh9-cell" });
    vi.mocked(listInstallationsForGitHubUser).mockResolvedValue([
      {
        id: 157921297,
        app_id: Number(APP_ID),
        account: { id: 1, login: "mohafnh9-cell", type: "User" },
        repository_selection: "all",
        suspended_at: null,
      },
    ]);

    const res = await GET(request());
    const body = await res.json();

    expect(body.installation).toBeNull();
    expect(body.availableInstallations).toEqual([
      { installationId: 157921297, accountLogin: "mohafnh9-cell", accountType: "User" },
    ]);
  });

  // SECURITY: never offer an installation the user merely has
  // read/write-collaborator repository access to -- only ones GitHub
  // confirms belong to the caller's own verified identity.
  it("does NOT surface an organization-owned installation the caller only has collaborator access to", async () => {
    vi.mocked(loadInstallationForOrganization).mockResolvedValue(null);
    vi.mocked(getStoredGitHubToken).mockResolvedValue("user-token");
    vi.mocked(fetchAuthenticatedGitHubUser).mockResolvedValue({ id: 1, login: "mohafnh9-cell" });
    vi.mocked(listInstallationsForGitHubUser).mockResolvedValue([
      {
        id: 555,
        app_id: Number(APP_ID),
        account: { id: 999, login: "some-other-org", type: "Organization" },
        repository_selection: "selected",
        suspended_at: null,
      },
    ]);

    const res = await GET(request());
    const body = await res.json();

    expect(body.availableInstallations).toEqual([]);
  });

  // 12. connected installation -- no extra GitHub API call needed/made
  it("does not check for available installations when this org already has one connected", async () => {
    vi.mocked(loadInstallationForOrganization).mockResolvedValue({
      id: "row-1",
      organization_id: ORG,
      github_installation_id: 157921297,
      github_account_id: 1,
      github_account_login: "mohafnh9-cell",
      github_account_type: "User",
      status: "active",
      permissions_snapshot: {},
      repository_selection: "all",
      installed_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      revoked_at: null,
    });

    const res = await GET(request());
    const body = await res.json();

    expect(body.installation).not.toBeNull();
    expect(body.availableInstallations).toEqual([]);
    expect(getStoredGitHubToken).not.toHaveBeenCalled();
    expect(listInstallationsForGitHubUser).not.toHaveBeenCalled();
  });

  it("does not crash or expose available installations when GitHub's API is unavailable", async () => {
    vi.mocked(loadInstallationForOrganization).mockResolvedValue(null);
    vi.mocked(getStoredGitHubToken).mockResolvedValue("user-token");
    vi.mocked(listInstallationsForGitHubUser).mockResolvedValue(null);

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.availableInstallations).toEqual([]);
  });
});
