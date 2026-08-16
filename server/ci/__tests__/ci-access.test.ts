import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { assertProjectInOrg, McpError, resolveMcpAuth } from "@/server/mcp/auth";
import { requireProjectApiAccess } from "@/server/projects/project-access";
import { requireCiProjectAccess } from "../ci-access";

vi.mock("@/server/mcp/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/mcp/auth")>();
  return {
    ...actual,
    resolveMcpAuth: vi.fn(),
    assertProjectInOrg: vi.fn(),
  };
});

vi.mock("@/server/projects/project-access", () => ({
  requireProjectApiAccess: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    },
  })),
}));

vi.mock("@/server/security-scanner/admin-client", () => ({
  createAdminClient: vi.fn(() => ({ from: vi.fn() })),
}));

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "33333333-3333-4333-8333-333333333333";
const ORG_A = "22222222-2222-4222-8222-222222222222";

describe("requireCiProjectAccess tenant isolation", () => {
  beforeEach(() => {
    vi.mocked(resolveMcpAuth).mockReset();
    vi.mocked(assertProjectInOrg).mockReset();
    vi.mocked(requireProjectApiAccess).mockReset();
  });

  it("rejects cross-tenant MCP project access", async () => {
    vi.mocked(resolveMcpAuth).mockResolvedValue({
      authType: "api_key",
      organizationId: ORG_A,
      userId: "user-a",
      admin: {} as never,
      scopes: [],
      source: "legacy_api_key",
    });
    vi.mocked(assertProjectInOrg).mockRejectedValue(
      new McpError(404, "project_not_found", "Project not found in your organization")
    );

    const request = new Request("https://example.com", {
      headers: { Authorization: "Bearer seq_live_test" },
    });
    const result = await requireCiProjectAccess(request, PROJECT_B);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(404);
    }
  });

  it("allows MCP access when project belongs to org", async () => {
    vi.mocked(resolveMcpAuth).mockResolvedValue({
      authType: "api_key",
      organizationId: ORG_A,
      userId: "user-a",
      admin: { from: vi.fn() } as never,
      scopes: [],
      source: "legacy_api_key",
    });
    vi.mocked(assertProjectInOrg).mockResolvedValue({
      id: PROJECT_A,
      organization_id: ORG_A,
      name: "demo",
      github_repo: "org/repo",
    });

    const request = new Request("https://example.com", {
      headers: { Authorization: "Bearer seq_live_test" },
    });
    const result = await requireCiProjectAccess(request, PROJECT_A);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.access.authSource).toBe("api_key");
      expect(result.access.project.id).toBe(PROJECT_A);
    }
  });

  it("falls back to session access when no bearer token", async () => {
    vi.mocked(resolveMcpAuth).mockResolvedValue(null);
    vi.mocked(requireProjectApiAccess).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const result = await requireCiProjectAccess(new Request("https://example.com"), PROJECT_A);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });
});
