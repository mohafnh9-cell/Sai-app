import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveGitHubCredential } from "@/server/github-app/credential-provider";
import { resolveOrganizationGitHubToken } from "../token-resolver";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/server/github-app/credential-provider", () => ({
  resolveGitHubCredential: vi.fn(),
}));

describe("GitHub automation token resolver", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("does not use GH_TOKEN when the production OAuth connection is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GH_TOKEN", "gho_must_not_be_used");
    vi.mocked(resolveGitHubCredential).mockResolvedValue(null);

    const limit = vi.fn().mockResolvedValue({ error: null });
    const select = vi.fn(() => ({ limit }));
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => ({ select })),
    } as never);

    const result = await resolveOrganizationGitHubToken(
      { from: vi.fn() } as never,
      "organization-a",
      "project-a"
    );

    expect(result).toBeNull();
    expect(resolveGitHubCredential).toHaveBeenCalledWith(
      expect.anything(),
      "organization-a",
      "project-a"
    );
  });

  it("returns auth source metadata from credential provider", async () => {
    vi.mocked(resolveGitHubCredential).mockResolvedValue({
      token: "token",
      userId: "user-1",
      source: "github_app",
      connectionId: null,
      githubInstallationId: 42,
    });

    const result = await resolveOrganizationGitHubToken(
      { from: vi.fn() } as never,
      "organization-a",
      "project-a"
    );

    expect(result).toEqual({
      token: "token",
      userId: "user-1",
      authSource: "github_app",
    });
  });
});
