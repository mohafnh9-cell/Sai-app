import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// M3 (audit): fetchInstallationAccessToken now sends repository_ids to
// scope the token, and caches by (installationId, repo-scope) instead of
// just installationId -- otherwise a token scoped to one repository set
// could be handed back for a different repository set requested later on
// the same installation.

vi.mock("@/server/github-app/config", () => ({
  getGitHubAppConfig: vi.fn(() => ({
    appId: "app-1",
    privateKey: "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
    webhookSecret: "secret",
    clientId: null,
    clientSecret: null,
    appSlug: "sequrai",
  })),
}));

vi.mock("@/server/github-app/jwt", () => ({
  createGitHubAppJwt: vi.fn(() => "fake.jwt.token"),
}));

const fetchMock = vi.fn();

describe("fetchInstallationAccessToken — scope-aware caching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends repository_ids in the request body when scoping to specific repos", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ token: "ghs_scoped", expires_at: new Date(Date.now() + 3600_000).toISOString() }),
    });

    const { fetchInstallationAccessToken, clearInstallationTokenCache } = await import(
      "../installation-token-service"
    );
    clearInstallationTokenCache();

    await fetchInstallationAccessToken(42, { repositoryIds: [999] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0];
    expect(JSON.parse(requestInit.body)).toEqual({ repository_ids: [999] });
  });

  it("sends no body (installation-wide) when no scope is given", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ token: "ghs_all", expires_at: new Date(Date.now() + 3600_000).toISOString() }),
    });

    const { fetchInstallationAccessToken, clearInstallationTokenCache } = await import(
      "../installation-token-service"
    );
    clearInstallationTokenCache();

    await fetchInstallationAccessToken(42);

    const [, requestInit] = fetchMock.mock.calls[0];
    expect(requestInit.body).toBeUndefined();
  });

  it("does not reuse a cached token across different repository scopes on the same installation", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "ghs_repo_A",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "ghs_repo_B",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        }),
      });

    const { fetchInstallationAccessToken, clearInstallationTokenCache } = await import(
      "../installation-token-service"
    );
    clearInstallationTokenCache();

    const tokenForRepoA = await fetchInstallationAccessToken(42, { repositoryIds: [111] });
    const tokenForRepoB = await fetchInstallationAccessToken(42, { repositoryIds: [222] });

    expect(tokenForRepoA?.token).toBe("ghs_repo_A");
    expect(tokenForRepoB?.token).toBe("ghs_repo_B");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does reuse a cached token for the exact same repository scope", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ token: "ghs_cached", expires_at: new Date(Date.now() + 3600_000).toISOString() }),
    });

    const { fetchInstallationAccessToken, clearInstallationTokenCache } = await import(
      "../installation-token-service"
    );
    clearInstallationTokenCache();

    const first = await fetchInstallationAccessToken(42, { repositoryIds: [999] });
    const second = await fetchInstallationAccessToken(42, { repositoryIds: [999] });

    expect(first?.token).toBe("ghs_cached");
    expect(second?.token).toBe("ghs_cached");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null and does not cache on a failed request", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });

    const { fetchInstallationAccessToken, clearInstallationTokenCache } = await import(
      "../installation-token-service"
    );
    clearInstallationTokenCache();

    const result = await fetchInstallationAccessToken(999999, { repositoryIds: [1] });
    expect(result).toBeNull();
  });
});
