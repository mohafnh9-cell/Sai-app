import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveWorkspaceGitHubToken } from "@/server/github/workspace-connection-service";
import { resolveOrganizationGitHubToken } from "../token-resolver";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/server/github/workspace-connection-service", () => ({
  resolveWorkspaceGitHubToken: vi.fn(),
}));

describe("GitHub automation token resolver", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("does not use GH_TOKEN when the production OAuth connection is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GH_TOKEN", "gho_must_not_be_used");
    vi.mocked(resolveWorkspaceGitHubToken).mockResolvedValue(null);

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
    expect(resolveWorkspaceGitHubToken).toHaveBeenCalledWith(
      expect.anything(),
      "organization-a",
      "project-a"
    );
  });
});
