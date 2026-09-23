import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discoverVerifiedInstallationsForUser,
  resolveGitHubProviderId,
  verifyInstallationOwnership,
} from "@/server/github-app/installation-authorization";
import { fetchGitHubInstallation } from "@/server/github-app/github-api";

vi.mock("@/server/github-app/github-api", () => ({
  fetchGitHubInstallation: vi.fn(),
}));

function githubInstallation(overrides: Partial<{
  id: number;
  accountId: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  suspended: boolean;
}> = {}) {
  return {
    id: overrides.id ?? 157921297,
    account: {
      id: overrides.accountId ?? 234916357,
      login: overrides.accountLogin ?? "mohafnh9-cell",
      type: overrides.accountType ?? "User",
    },
    repository_selection: "all" as const,
    permissions: {},
    suspended_at: overrides.suspended ? "2026-01-01T00:00:00Z" : null,
  };
}

function adminClient(overrides: {
  getUserByIdResult?: { data: unknown; error: unknown };
  installationRows?: Array<{ github_installation_id: number }>;
} = {}) {
  return {
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue(
          overrides.getUserByIdResult ?? { data: { user: { identities: [] } }, error: null }
        ),
      },
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ data: overrides.installationRows ?? [] }),
        })),
      })),
    })),
  } as unknown as Parameters<typeof resolveGitHubProviderId>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveGitHubProviderId", () => {
  // 1/3. Provider must be GitHub specifically, never inferred from anything else.
  it("returns the numeric provider_id for a linked github identity", async () => {
    const admin = adminClient({
      getUserByIdResult: {
        data: {
          user: {
            identities: [
              { provider: "github", identity_data: { provider_id: "234916357", user_name: "mohafnh9-cell" } },
            ],
          },
        },
        error: null,
      },
    });

    const result = await resolveGitHubProviderId(admin, "user-1");

    expect(result).toBe(234916357);
  });

  it("falls back to identity_data.sub when provider_id is absent", async () => {
    const admin = adminClient({
      getUserByIdResult: {
        data: { user: { identities: [{ provider: "github", identity_data: { sub: "234916357" } }] } },
        error: null,
      },
    });

    const result = await resolveGitHubProviderId(admin, "user-1");

    expect(result).toBe(234916357);
  });

  // 3. Only a github-provider identity counts -- e.g. google must be ignored.
  it("ignores a non-github identity (e.g. google) even if present", async () => {
    const admin = adminClient({
      getUserByIdResult: {
        data: {
          user: {
            identities: [{ provider: "google", identity_data: { provider_id: "110298770114289286564" } }],
          },
        },
        error: null,
      },
    });

    const result = await resolveGitHubProviderId(admin, "user-1");

    expect(result).toBeNull();
  });

  // 4. Missing GitHub identity -> safe failure (null, not a throw, not a guess).
  it("returns null when the user has no linked identities at all", async () => {
    const admin = adminClient({ getUserByIdResult: { data: { user: { identities: [] } }, error: null } });

    const result = await resolveGitHubProviderId(admin, "user-1");

    expect(result).toBeNull();
  });

  it("returns null when Supabase admin lookup errors", async () => {
    const admin = adminClient({ getUserByIdResult: { data: null, error: { message: "not found" } } });

    const result = await resolveGitHubProviderId(admin, "user-1");

    expect(result).toBeNull();
  });
});

describe("verifyInstallationOwnership", () => {
  const providerId = 234916357;

  // 1. Match -> success
  it("succeeds when app-confirmed installation matches the verified provider id (personal, active)", async () => {
    vi.mocked(fetchGitHubInstallation).mockResolvedValue(githubInstallation());

    const result = await verifyInstallationOwnership(157921297, providerId);

    expect(result).toEqual({
      githubInstallationId: 157921297,
      accountId: 234916357,
      accountLogin: "mohafnh9-cell",
    });
  });

  // 2. Mismatch -> reject
  it("rejects when the installation's account id does not match the verified provider id", async () => {
    vi.mocked(fetchGitHubInstallation).mockResolvedValue(githubInstallation({ accountId: 999999 }));

    const result = await verifyInstallationOwnership(157921297, providerId);

    expect(result).toBeNull();
  });

  // 5. Organization-owned -> reject
  it("rejects an organization-owned installation even if the account id matches", async () => {
    vi.mocked(fetchGitHubInstallation).mockResolvedValue(
      githubInstallation({ accountId: providerId, accountType: "Organization" })
    );

    const result = await verifyInstallationOwnership(157921297, providerId);

    expect(result).toBeNull();
  });

  // 6. Different app -> reject (fetchGitHubInstallation itself 404s/returns null for a
  // different app's installation id, since it's called with this app's own JWT).
  it("rejects when fetchGitHubInstallation returns null (e.g. the id belongs to a different app)", async () => {
    vi.mocked(fetchGitHubInstallation).mockResolvedValue(null);

    const result = await verifyInstallationOwnership(999999999, providerId);

    expect(result).toBeNull();
  });

  // 7. Suspended -> reject
  it("rejects a suspended installation", async () => {
    vi.mocked(fetchGitHubInstallation).mockResolvedValue(
      githubInstallation({ accountId: providerId, suspended: true })
    );

    const result = await verifyInstallationOwnership(157921297, providerId);

    expect(result).toBeNull();
  });

  // 8. Missing from GitHub -> reject
  it("rejects when GitHub reports the installation does not exist", async () => {
    vi.mocked(fetchGitHubInstallation).mockResolvedValue(null);

    const result = await verifyInstallationOwnership(157921297, providerId);

    expect(result).toBeNull();
  });
});

describe("discoverVerifiedInstallationsForUser", () => {
  const providerId = 234916357;

  it("returns candidates from the database that are also live-confirmed by GitHub", async () => {
    const admin = adminClient({ installationRows: [{ github_installation_id: 157921297 }] });
    vi.mocked(fetchGitHubInstallation).mockResolvedValue(githubInstallation({ accountId: providerId }));

    const result = await discoverVerifiedInstallationsForUser(admin, providerId);

    expect(result).toEqual([{ githubInstallationId: 157921297, accountId: providerId, accountLogin: "mohafnh9-cell" }]);
  });

  // 10. DB row exists but live GitHub data no longer matches -> excluded
  it("excludes a DB candidate whose live GitHub data no longer matches (e.g. now suspended)", async () => {
    const admin = adminClient({ installationRows: [{ github_installation_id: 157921297 }] });
    vi.mocked(fetchGitHubInstallation).mockResolvedValue(
      githubInstallation({ accountId: providerId, suspended: true })
    );

    const result = await discoverVerifiedInstallationsForUser(admin, providerId);

    expect(result).toEqual([]);
  });

  it("returns an empty array when there are no database candidates at all", async () => {
    const admin = adminClient({ installationRows: [] });

    const result = await discoverVerifiedInstallationsForUser(admin, providerId);

    expect(result).toEqual([]);
    expect(fetchGitHubInstallation).not.toHaveBeenCalled();
  });

  it("de-duplicates repeated installation ids before re-verifying", async () => {
    const admin = adminClient({
      installationRows: [{ github_installation_id: 157921297 }, { github_installation_id: 157921297 }],
    });
    vi.mocked(fetchGitHubInstallation).mockResolvedValue(githubInstallation({ accountId: providerId }));

    await discoverVerifiedInstallationsForUser(admin, providerId);

    expect(fetchGitHubInstallation).toHaveBeenCalledTimes(1);
  });
});
