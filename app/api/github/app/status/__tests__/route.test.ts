import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/github/app/status/route";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { isGitHubAppConfigured } from "@/server/github-app/config";
import { loadInstallationForOrganization } from "@/server/github-app/installation-store";
import {
  discoverVerifiedInstallationsForUser,
  resolveGitHubProviderId,
} from "@/server/github-app/installation-authorization";
import { assertWorkspaceMembership } from "@/server/workspaces/service";
import { enforceRateLimit } from "@/server/http/rate-limit";

vi.mock("@/lib/auth/dev-bypass", () => ({ getServerAuthContext: vi.fn() }));
vi.mock("@/server/github-app/config", () => ({ isGitHubAppConfigured: vi.fn() }));
vi.mock("@/server/github-app/installation-store", () => ({ loadInstallationForOrganization: vi.fn() }));
vi.mock("@/server/github-app/installation-authorization", () => ({
  discoverVerifiedInstallationsForUser: vi.fn(),
  resolveGitHubProviderId: vi.fn(),
}));
vi.mock("@/server/workspaces/service", () => ({ assertWorkspaceMembership: vi.fn() }));
vi.mock("@/server/http/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/server/security-scanner/admin-client", () => ({ createAdminClient: vi.fn(() => ({})) }));

const ORG = "org-under-test";
const PROVIDER_ID = 234916357;

function request() {
  return new Request("https://app.example.com/api/github/app/status");
}

beforeEach(() => {
  vi.mocked(enforceRateLimit).mockResolvedValue(null);
  vi.mocked(isGitHubAppConfigured).mockReturnValue(true);
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
  // 18. no verified candidate -> clear "nothing available" state
  it("reports no installation and no available installations when nothing exists anywhere", async () => {
    vi.mocked(loadInstallationForOrganization).mockResolvedValue(null);
    vi.mocked(resolveGitHubProviderId).mockResolvedValue(null);

    const res = await GET(request());
    const body = await res.json();

    expect(body.installation).toBeNull();
    expect(body.availableInstallations).toEqual([]);
    expect(discoverVerifiedInstallationsForUser).not.toHaveBeenCalled();
  });

  it("surfaces a verified, unattached installation as available when this org has none", async () => {
    vi.mocked(loadInstallationForOrganization).mockResolvedValue(null);
    vi.mocked(resolveGitHubProviderId).mockResolvedValue(PROVIDER_ID);
    vi.mocked(discoverVerifiedInstallationsForUser).mockResolvedValue([
      { githubInstallationId: 157921297, accountId: PROVIDER_ID, accountLogin: "mohafnh9-cell" },
    ]);

    const res = await GET(request());
    const body = await res.json();

    expect(body.installation).toBeNull();
    expect(body.availableInstallations).toEqual([
      { installationId: 157921297, accountLogin: "mohafnh9-cell" },
    ]);
    expect(discoverVerifiedInstallationsForUser).toHaveBeenCalledWith(expect.anything(), PROVIDER_ID);
  });

  // 16. already-connected organization does not perform unnecessary discovery
  it("does not check for available installations when this org already has one connected", async () => {
    vi.mocked(loadInstallationForOrganization).mockResolvedValue({
      id: "row-1",
      organization_id: ORG,
      github_installation_id: 157921297,
      github_account_id: PROVIDER_ID,
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
    expect(resolveGitHubProviderId).not.toHaveBeenCalled();
    expect(discoverVerifiedInstallationsForUser).not.toHaveBeenCalled();
  });

  // 19. status does not leak unrelated organization information -- only
  // installationId/accountLogin are ever returned, nothing about which
  // other SequrAI organization(s) also hold the installation.
  it("never includes organization identifiers in the available-installations payload", async () => {
    vi.mocked(loadInstallationForOrganization).mockResolvedValue(null);
    vi.mocked(resolveGitHubProviderId).mockResolvedValue(PROVIDER_ID);
    vi.mocked(discoverVerifiedInstallationsForUser).mockResolvedValue([
      { githubInstallationId: 157921297, accountId: PROVIDER_ID, accountLogin: "mohafnh9-cell" },
    ]);

    const res = await GET(request());
    const body = await res.json();

    for (const entry of body.availableInstallations) {
      expect(Object.keys(entry).sort()).toEqual(["accountLogin", "installationId"]);
    }
  });
});
