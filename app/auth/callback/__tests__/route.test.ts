import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/auth/callback/route";
import { createClient } from "@/lib/supabase/server";
import { saveGitHubToken } from "@/lib/github/token-store";
import {
  createGitHubOAuthState,
  githubOAuthStateCookieName,
} from "@/lib/github/oauth-state";
import { upsertWorkspaceGitHubConnection } from "@/server/github/workspace-connection-service";
import { assertWorkspaceMembership } from "@/server/workspaces/service";
import { enforceRateLimit } from "@/server/http/rate-limit";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/github/token-store", () => ({
  saveGitHubToken: vi.fn(),
}));

vi.mock("@/server/github/workspace-connection-service", () => ({
  upsertWorkspaceGitHubConnection: vi.fn(),
}));

vi.mock("@/server/workspaces/service", () => ({
  assertWorkspaceMembership: vi.fn(),
}));

vi.mock("@/server/http/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
}));

const providerToken = "oauth-provider-test-token";
const refreshToken = "oauth-refresh-test-token";

function callbackRequest() {
  const state = createGitHubOAuthState("workspace-a", "user-a");
  return new NextRequest(
    "https://app.example.com/auth/callback?code=oauth-code&next=%2Fintegrations",
    {
      headers: {
        cookie: `${githubOAuthStateCookieName}=${state.cookieValue}`,
      },
    }
  );
}

beforeEach(() => {
  vi.stubEnv("GITHUB_OAUTH_STATE_SECRET", "test-only-oauth-state-secret");
  vi.mocked(enforceRateLimit).mockReturnValue(null);
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      exchangeCodeForSession: vi.fn().mockResolvedValue({
        data: {
          session: {
            provider_token: providerToken,
            provider_refresh_token: refreshToken,
          },
          user: { id: "user-a" },
        },
        error: null,
      }),
    },
  } as never);
  vi.mocked(saveGitHubToken).mockResolvedValue(undefined);
  vi.mocked(assertWorkspaceMembership).mockResolvedValue(true);
  vi.mocked(upsertWorkspaceGitHubConnection).mockResolvedValue({
    connectionId: "connection-a",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("GitHub OAuth callback reconnection", () => {
  it("validates the existing flow and updates the Workspace connection", async () => {
    const response = await GET(callbackRequest());

    expect(assertWorkspaceMembership).toHaveBeenCalledWith(
      expect.anything(),
      "user-a",
      "workspace-a"
    );
    expect(upsertWorkspaceGitHubConnection).toHaveBeenCalledWith({
      organizationId: "workspace-a",
      connectedByUserId: "user-a",
      accessToken: providerToken,
      refreshToken,
    });
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/integrations"
    );
  });

  it("does not log provider tokens when reconnection storage fails", async () => {
    vi.mocked(upsertWorkspaceGitHubConnection).mockRejectedValue(
      new Error(`storage failed for ${providerToken}`)
    );
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(callbackRequest());

    const logged = JSON.stringify(errorLog.mock.calls);
    expect(logged).toContain("auth_callback_workspace_connection_failed");
    expect(logged).not.toContain(providerToken);
    expect(logged).not.toContain(refreshToken);
    expect(response.headers.get("location")).toContain(
      "/integrations?githubError=github_connection_failed"
    );
  });
});
