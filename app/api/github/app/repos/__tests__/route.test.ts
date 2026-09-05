import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubInstallationApiError } from "@/server/github-app/github-api";

const state = vi.hoisted(() => ({
  configured: true,
  auth: null as { user: { id: string }; organizationId: string; supabase: unknown } | null,
  membershipAllowed: true,
  installation: null as { id: string; github_installation_id: number; status: string; revoked_at: string | null } | null,
  reposResult: [] as Array<Record<string, unknown>> | { throw: GitHubInstallationApiError },
}));

vi.mock("@/server/github-app/config", () => ({
  isGitHubAppConfigured: vi.fn(() => state.configured),
}));
vi.mock("@/lib/auth/dev-bypass", () => ({
  getServerAuthContext: vi.fn(async () => state.auth),
}));
vi.mock("@/server/workspaces/service", () => ({
  assertWorkspaceMembership: vi.fn(async () => state.membershipAllowed),
}));
vi.mock("@/server/http/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => null),
}));
vi.mock("@/server/security-scanner/admin-client", () => ({
  createAdminClient: vi.fn(() => ({})),
}));
vi.mock("@/server/github-app/installation-store", () => ({
  loadInstallationForOrganization: vi.fn(async () => state.installation),
}));
vi.mock("@/server/github-app/github-api", async () => {
  const actual = await vi.importActual<typeof import("@/server/github-app/github-api")>(
    "@/server/github-app/github-api"
  );
  return {
    ...actual,
    listInstallationRepositories: vi.fn(async () => {
      if (!Array.isArray(state.reposResult)) throw state.reposResult.throw;
      return state.reposResult;
    }),
  };
});

import { GET } from "@/app/api/github/app/repos/route";

function req() {
  return new Request("https://example.com/api/github/app/repos");
}

const activeInstallation = {
  id: "install-row-1",
  github_installation_id: 555,
  status: "active",
  revoked_at: null,
};

describe("GET /api/github/app/repos", () => {
  beforeEach(() => {
    state.configured = true;
    state.auth = { user: { id: "user-1" }, organizationId: "org-1", supabase: {} };
    state.membershipAllowed = true;
    state.installation = activeInstallation;
    state.reposResult = [];
  });

  it("returns an empty configured=false response when the GitHub App is not configured (never a fake 200 repo list)", async () => {
    state.configured = false;
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ repos: [], configured: false });
  });

  it("returns 401 for an unauthenticated request", async () => {
    state.auth = null;
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("returns 403 when the user fails the workspace membership check", async () => {
    state.membershipAllowed = false;
    const res = await GET(req());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("workspace_access_denied");
  });

  it("returns installationActive=false when the organization has no active installation (does not error)", async () => {
    state.installation = null;
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ repos: [], configured: true, installationActive: false });
  });

  it("returns installationActive=false when the installation is revoked", async () => {
    state.installation = { ...activeInstallation, status: "active", revoked_at: "2026-01-01T00:00:00Z" };
    const res = await GET(req());
    const body = await res.json();
    expect(body.installationActive).toBe(false);
  });

  it("maps a GitHub 401/403 to a structured 403 github_forbidden (not a fake empty list)", async () => {
    state.reposResult = { throw: new GitHubInstallationApiError(403, "forbidden") };
    const res = await GET(req());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("github_forbidden");
  });

  it("maps a GitHub 404 to a structured 404 github_not_found", async () => {
    state.reposResult = { throw: new GitHubInstallationApiError(404, "not found") };
    const res = await GET(req());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("github_not_found");
  });

  it("maps a GitHub 429 to a structured 429 github_rate_limited", async () => {
    state.reposResult = { throw: new GitHubInstallationApiError(429, "rate limited") };
    const res = await GET(req());
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("github_rate_limited");
  });

  it("maps a GitHub 5xx to a structured 502 github_unavailable", async () => {
    state.reposResult = { throw: new GitHubInstallationApiError(500, "server error") };
    const res = await GET(req());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("github_unavailable");
  });

  it("successful repository listing: returns the mapped repo shape with stable numeric ids", async () => {
    state.reposResult = [
      {
        id: 111,
        full_name: "acme/widgets",
        description: "d",
        html_url: "https://github.com/acme/widgets",
        private: false,
        language: "TypeScript",
        updated_at: "2026-01-01T00:00:00Z",
        stargazers_count: 5,
        default_branch: "main",
      },
    ];
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.installationActive).toBe(true);
    expect(body.repos).toEqual([
      expect.objectContaining({ id: 111, name: "widgets", full_name: "acme/widgets" }),
    ]);
  });

  it("a genuinely empty repository result (real 200, zero repos) is returned as an empty array with installationActive=true, distinct from the not-configured/no-installation cases", async () => {
    state.reposResult = [];
    const res = await GET(req());
    const body = await res.json();
    expect(body.repos).toEqual([]);
    expect(body.installationActive).toBe(true);
    expect(body.configured).toBe(true);
  });
});
