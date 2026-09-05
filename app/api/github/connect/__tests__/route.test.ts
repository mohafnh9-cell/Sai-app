import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";

const ORG_A = "org-a";
const ORG_B = "org-b";
const USER_1 = "user-1";

function fakeRepo(id: number, name = `repo-${id}`) {
  return {
    id,
    name,
    full_name: `acme/${name}`,
    description: null,
    html_url: `https://github.com/acme/${name}`,
    private: false,
    language: null,
    updated_at: "2026-01-01T00:00:00Z",
    stargazers_count: 0,
    default_branch: "main",
  };
}

const state = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  organizationId: "org-a" as string | null,
  credential: { token: "gh-token", source: "oauth_legacy" as "oauth_legacy" | "github_app", connectionId: "conn-1", userId: "user-1" } as
    | { token: string; source: "oauth_legacy" | "github_app"; connectionId: string; userId: string }
    | null,
  installation: null as { id: string } | null,
  installationOwnsRepo: true,
  repoLookup: (id: number) => fakeRepo(id) as ReturnType<typeof fakeRepo> | null,
  membershipAllowed: true,
  switchOk: true,
}));

vi.mock("@/server/http/rate-limit", () => ({ enforceRateLimit: vi.fn(async () => null) }));
vi.mock("@/server/github-automation/register-webhook", () => ({
  registerProjectWebhook: vi.fn(async () => ({ status: "created" })),
  webhookErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));
vi.mock("@/server/organizations/resolve-user-organization", () => ({
  resolveUserOrganizationId: vi.fn(async (_s: unknown, _u: string, requested: string) =>
    requested === state.organizationId ? state.organizationId : null
  ),
}));
vi.mock("@/server/workspaces/service", () => ({
  resolveActiveWorkspaceIdForUser: vi.fn(async () => state.organizationId),
  assertWorkspaceMembership: vi.fn(async () => state.membershipAllowed),
}));
vi.mock("@/server/workspaces/mutations", () => ({
  switchActiveWorkspace: vi.fn(async () => ({ ok: state.switchOk })),
}));
vi.mock("@/server/github-app/credential-provider", () => ({
  resolveGitHubCredential: vi.fn(async () => state.credential),
}));
vi.mock("@/server/github-app/installation-events", () => ({
  assertInstallationOwnsRepository: vi.fn(async () => state.installationOwnsRepo),
}));
vi.mock("@/server/github-app/installation-store", () => ({
  loadInstallationForOrganization: vi.fn(async () => state.installation),
}));
vi.mock("@/lib/github", () => ({
  getGitHubRepoById: vi.fn(async (_token: string, id: number) => state.repoLookup(id)),
}));

let tables: FakeTables;
let fakeAdmin: ReturnType<typeof createFakeAdmin>;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: state.user } })),
      getSession: vi.fn(async () => ({ data: { session: state.user ? {} : null } })),
    },
    from: (table: string) => fakeAdmin.from(table),
  })),
}));
vi.mock("@/server/security-scanner/admin-client", () => ({
  createAdminClient: vi.fn(() => fakeAdmin),
}));

import { POST } from "@/app/api/github/connect/route";

function postReq(body: unknown) {
  return new Request("https://example.com/api/github/connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/github/connect", () => {
  beforeEach(() => {
    state.user = { id: USER_1 };
    state.organizationId = ORG_A;
    state.credential = { token: "gh-token", source: "oauth_legacy", connectionId: "conn-1", userId: USER_1 };
    state.installation = null;
    state.installationOwnsRepo = true;
    state.repoLookup = (id) => fakeRepo(id);
    state.membershipAllowed = true;
    state.switchOk = true;
    tables = { projects: [] };
    fakeAdmin = createFakeAdmin(tables);
  });

  it("returns 401 for an unauthenticated request", async () => {
    state.user = null;
    const res = await POST(postReq({ repos: [{ id: 1 }] }));
    expect(res.status).toBe(401);
  });

  it("returns 422 for invalid repository IDs (empty array)", async () => {
    const res = await POST(postReq({ repos: [] }));
    expect(res.status).toBe(422);
  });

  it("returns 422 for a non-numeric repository id", async () => {
    const res = await POST(postReq({ repos: [{ id: "not-a-number" }] }));
    expect(res.status).toBe(422);
  });

  it("accepts exactly 100 repositories", async () => {
    const repos = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }));
    const res = await POST(postReq({ repos }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toBe(100);
    expect(body.total).toBe(100);
  });

  it("returns 422 for 101 repositories (over the max(100) boundary)", async () => {
    const repos = Array.from({ length: 101 }, (_, i) => ({ id: i + 1 }));
    const res = await POST(postReq({ repos }));
    expect(res.status).toBe(422);
  });

  it("deduplicates repeated repository IDs in one request", async () => {
    const res = await POST(postReq({ repos: [{ id: 1 }, { id: 1 }, { id: 2 }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toBe(2);
    expect(body.total).toBe(2);
  });

  it("returns 403 repository_not_authorized when a repo cannot be verified (GitHub lookup returns null for any selected repo)", async () => {
    state.repoLookup = (id) => (id === 2 ? null : fakeRepo(id));
    const res = await POST(postReq({ repos: [{ id: 1 }, { id: 2 }] }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("repository_not_authorized");
    expect(tables.projects).toHaveLength(0);
  });

  it("SECURITY (tenant isolation): rejects a repository already connected to a DIFFERENT organization the user cannot access", async () => {
    tables.projects.push({ id: "existing-1", organization_id: ORG_B, github_repository_id: 1 });
    state.membershipAllowed = false;
    const res = await POST(postReq({ repos: [{ id: 1 }] }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("repository_already_connected");
  });

  it("self-heals when a repo is already connected to another org the SAME user is a member of: switches workspace and returns the existing project, does not create a duplicate", async () => {
    tables.projects.push({ id: "existing-1", organization_id: ORG_B, github_repository_id: 1 });
    state.membershipAllowed = true;
    const res = await POST(postReq({ repos: [{ id: 1 }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recovered).toBe(true);
    expect(body.projectIds).toEqual(["existing-1"]);
    expect(body.workspaceId).toBe(ORG_B);
    expect(tables.projects).toHaveLength(1);
  });

  it("returns 403 installation_not_found when using the GitHub App path but no installation row exists for the org", async () => {
    state.credential = { token: "gh-token", source: "github_app", connectionId: "conn-1", userId: USER_1 };
    state.installation = null;
    const res = await POST(postReq({ repos: [{ id: 1 }] }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("installation_not_found");
  });

  it("SECURITY: rejects a repository not owned by the installation (assertInstallationOwnsRepository = false)", async () => {
    state.credential = { token: "gh-token", source: "github_app", connectionId: "conn-1", userId: USER_1 };
    state.installation = { id: "install-row-1" };
    state.installationOwnsRepo = false;
    const res = await POST(postReq({ repos: [{ id: 1 }] }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("repository_not_in_installation");
  });

  it("successful multi-repository connection: creates one project per repo and reports webhook outcomes", async () => {
    const res = await POST(postReq({ repos: [{ id: 1 }, { id: 2 }, { id: 3 }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toBe(3);
    expect(body.projectIds).toHaveLength(3);
    expect(body.webhooksCreated).toBe(3);
    expect(tables.projects).toHaveLength(3);
    for (const p of tables.projects) {
      expect(p.organization_id).toBe(ORG_A);
    }
  });

  it("idempotent: connecting the same repository twice updates the existing project instead of creating a duplicate", async () => {
    const first = await POST(postReq({ repos: [{ id: 1 }] }));
    const firstBody = await first.json();
    expect(tables.projects).toHaveLength(1);

    const second = await POST(postReq({ repos: [{ id: 1 }] }));
    const secondBody = await second.json();
    expect(tables.projects).toHaveLength(1);
    expect(secondBody.projectIds).toEqual(firstBody.projectIds);
  });

  it("returns 403 github_not_connected when no GitHub credential can be resolved for the organization", async () => {
    state.credential = null;
    const res = await POST(postReq({ repos: [{ id: 1 }] }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("github_not_connected");
  });
});
