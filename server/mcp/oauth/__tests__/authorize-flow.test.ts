import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeS256Challenge, generateCodeVerifier } from "@/server/mcp/oauth/pkce";
import { createAuthorizationCode, exchangeAuthorizationCode } from "@/server/mcp/oauth/codes";
import { issueTokenPair } from "@/server/mcp/oauth/tokens";
import { createFakeAdmin } from "@/server/mcp/__tests__/fake-admin";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

describe("OAuth authorize flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs authorize → code → token exchange", async () => {
    const verifier = generateCodeVerifier();
    const challenge = computeS256Challenge(verifier);

    const admin = createFakeAdmin({
      mcp_oauth_authorization_codes: [],
      mcp_oauth_access_tokens: [],
      mcp_oauth_refresh_tokens: [],
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const code = await createAuthorizationCode({
      clientId: "sequrai-mcp-inspector",
      userId: "user-1",
      organizationId: "org-1",
      redirectUri: "http://127.0.0.1:6274/oauth/callback",
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      scopes: ["mcp:status:read", "mcp:audit:run"],
    });

    const authCode = await exchangeAuthorizationCode({
      code,
      clientId: "sequrai-mcp-inspector",
      redirectUri: "http://127.0.0.1:6274/oauth/callback",
      codeVerifier: verifier,
    });

    expect(authCode.organization_id).toBe("org-1");

    const tokens = await issueTokenPair({
      clientId: authCode.client_id,
      userId: authCode.user_id,
      organizationId: authCode.organization_id,
      scopes: authCode.scopes,
    });

    expect(tokens.access_token).toMatch(/^seq_oat_/);
    expect(tokens.refresh_token).toMatch(/^seq_ort_/);
  });
});
