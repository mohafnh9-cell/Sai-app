import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_A = "org-a";
const ORG_B = "org-b";
const INSTALL_ROW_A = "11111111-1111-4111-8111-111111111111";

const state = vi.hoisted(() => ({
  auth: null as { user: { id: string }; organizationId: string; supabase: unknown } | null,
  membershipAllowed: true,
  rows: new Map<
    string,
    {
      id: string;
      organization_id: string;
      github_installation_id: number;
      github_account_type: "User" | "Organization";
      github_account_login: string;
      status: string;
      revoked_at: string | null;
    }
  >(),
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
  loadInstallationByRowId: vi.fn(async (_admin: unknown, input: { installationRowId: string; organizationId: string }) => {
    const row = state.rows.get(input.installationRowId);
    if (!row || row.organization_id !== input.organizationId) return null;
    return row;
  }),
  markInstallationRevoked: vi.fn(async (_admin: unknown, input: { installationRowId: string; organizationId: string }) => {
    const row = state.rows.get(input.installationRowId);
    if (row && row.organization_id === input.organizationId) {
      row.status = "revoked";
      row.revoked_at = new Date().toISOString();
    }
  }),
}));

import { DELETE } from "@/app/api/github/app/installations/[installationId]/route";

function req() {
  return new Request(`https://example.com/api/github/app/installations/${INSTALL_ROW_A}`, { method: "DELETE" });
}

function params(id: string = INSTALL_ROW_A) {
  return { params: Promise.resolve({ installationId: id }) };
}

describe("DELETE /api/github/app/installations/[installationId]", () => {
  beforeEach(() => {
    state.auth = { user: { id: "user-1" }, organizationId: ORG_A, supabase: {} };
    state.membershipAllowed = true;
    state.rows = new Map([
      [
        INSTALL_ROW_A,
        {
          id: INSTALL_ROW_A,
          organization_id: ORG_A,
          github_installation_id: 999,
          github_account_type: "Organization",
          github_account_login: "acme",
          status: "active",
          revoked_at: null,
        },
      ],
    ]);
  });

  it("returns 400 for a malformed installation id", async () => {
    const res = await DELETE(req(), params("not-a-uuid"));
    expect(res.status).toBe(400);
  });

  it("returns 401 for an unauthenticated request", async () => {
    state.auth = null;
    const res = await DELETE(req(), params());
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller fails workspace membership", async () => {
    state.membershipAllowed = false;
    const res = await DELETE(req(), params());
    expect(res.status).toBe(403);
  });

  it("SECURITY (tenant isolation): returns 404 -- not the installation's real data -- for an installation belonging to another organization", async () => {
    state.auth = { user: { id: "user-1" }, organizationId: ORG_B, supabase: {} };
    const res = await DELETE(req(), params());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("installation_not_found");
    // The org-A row must be untouched by an org-B caller's request.
    expect(state.rows.get(INSTALL_ROW_A)?.status).toBe("active");
  });

  it("returns 404 for a well-formed but nonexistent installation id", async () => {
    const res = await DELETE(req(), params("22222222-2222-4222-8222-222222222222"));
    expect(res.status).toBe(404);
  });

  it("revokes the installation locally and returns a GitHub org-settings uninstall URL", async () => {
    const res = await DELETE(req(), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.revokedLocally).toBe(true);
    expect(body.githubUninstallRequired).toBe(true);
    expect(body.githubUninstallUrl).toBe("https://github.com/organizations/acme/settings/installations/999");
    expect(state.rows.get(INSTALL_ROW_A)?.status).toBe("revoked");
  });

  it("builds a personal-account uninstall URL for a User-type installation", async () => {
    state.rows.get(INSTALL_ROW_A)!.github_account_type = "User";
    const res = await DELETE(req(), params());
    const body = await res.json();
    expect(body.githubUninstallUrl).toBe("https://github.com/settings/installations/999");
  });

  it("IDEMPOTENT: calling DELETE twice succeeds both times and reports alreadyRevoked on the second call", async () => {
    const first = await DELETE(req(), params());
    const firstBody = await first.json();
    expect(firstBody.alreadyRevoked).toBe(false);

    const second = await DELETE(req(), params());
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.ok).toBe(true);
    expect(secondBody.alreadyRevoked).toBe(true);
  });

  it("never deletes the installation row -- only marks it revoked (projects/scans/history remain intact by construction, since nothing here touches those tables)", async () => {
    await DELETE(req(), params());
    expect(state.rows.has(INSTALL_ROW_A)).toBe(true);
    expect(state.rows.get(INSTALL_ROW_A)?.id).toBe(INSTALL_ROW_A);
  });
});
