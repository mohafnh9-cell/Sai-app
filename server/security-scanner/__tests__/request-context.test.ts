import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveGitHubCredential } from "@/server/github-app/credential-provider";
import { getScanRequestContext } from "../request-context";

vi.mock("@/server/github-app/credential-provider", () => ({
  resolveGitHubCredential: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ from: vi.fn() })),
}));

const USER_ID = "user-1";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ORG_A = "22222222-2222-4222-8222-222222222222";
const ORG_B = "33333333-3333-4333-8333-333333333333";

type SupabaseState = {
  user: { id: string } | null;
  project: { id: string; organization_id: string; github_repo: string | null } | null;
  membership: { user_id: string; organization_id: string } | null;
};

function mockClient(state: SupabaseState) {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: state.user } })),
    },
    from: vi.fn((table: string) => {
      if (table === "projects") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.project, error: null }) }) }) };
      }
      if (table === "organization_members") {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.membership }) }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";

describe("getScanRequestContext", () => {
  beforeEach(() => {
    vi.mocked(resolveGitHubCredential).mockReset();
  });

  it("rejects an unauthenticated caller", async () => {
    vi.mocked(createClient).mockResolvedValue(
      mockClient({ user: null, project: null, membership: null }) as never
    );

    await expect(getScanRequestContext(PROJECT_ID)).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    });
  });

  it("rejects a caller whose org membership does not match the project's org (cross-org IDOR)", async () => {
    vi.mocked(createClient).mockResolvedValue(
      mockClient({
        user: { id: USER_ID },
        project: { id: PROJECT_ID, organization_id: ORG_A, github_repo: "acme/app" },
        // Membership is in a different org than the project.
        membership: { user_id: USER_ID, organization_id: ORG_B },
      }) as never
    );

    await expect(getScanRequestContext(PROJECT_ID)).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
    expect(resolveGitHubCredential).not.toHaveBeenCalled();
  });

  it("resolves a GitHub App-backed credential through the canonical resolver", async () => {
    vi.mocked(createClient).mockResolvedValue(
      mockClient({
        user: { id: USER_ID },
        project: { id: PROJECT_ID, organization_id: ORG_A, github_repo: "acme/app" },
        membership: { user_id: USER_ID, organization_id: ORG_A },
      }) as never
    );
    vi.mocked(resolveGitHubCredential).mockResolvedValue({
      token: "app-token",
      userId: "github-app",
      source: "github_app",
      connectionId: null,
      githubInstallationId: 123,
    });

    const context = await getScanRequestContext(PROJECT_ID, true);

    expect(context.providerToken).toBe("app-token");
    expect(resolveGitHubCredential).toHaveBeenCalledWith(expect.anything(), ORG_A, PROJECT_ID);
  });

  it("fails safely with GITHUB_REAUTH_REQUIRED when no credential (App or legacy) resolves", async () => {
    vi.mocked(createClient).mockResolvedValue(
      mockClient({
        user: { id: USER_ID },
        project: { id: PROJECT_ID, organization_id: ORG_A, github_repo: "acme/app" },
        membership: { user_id: USER_ID, organization_id: ORG_A },
      }) as never
    );
    vi.mocked(resolveGitHubCredential).mockResolvedValue(null);

    await expect(getScanRequestContext(PROJECT_ID, true)).rejects.toMatchObject({
      status: 403,
      code: "GITHUB_REAUTH_REQUIRED",
    });
  });

  it("rejects when the project has no GitHub repository connected", async () => {
    vi.mocked(createClient).mockResolvedValue(
      mockClient({
        user: { id: USER_ID },
        project: { id: PROJECT_ID, organization_id: ORG_A, github_repo: null },
        membership: { user_id: USER_ID, organization_id: ORG_A },
      }) as never
    );

    await expect(getScanRequestContext(PROJECT_ID, true)).rejects.toMatchObject({
      status: 422,
      code: "GITHUB_REPOSITORY_REQUIRED",
    });
    expect(resolveGitHubCredential).not.toHaveBeenCalled();
  });
});
