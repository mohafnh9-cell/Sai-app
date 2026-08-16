import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createFakeAdmin } from "@/server/mcp/__tests__/fake-admin";
import { computeS256Challenge, generateCodeVerifier } from "@/server/mcp/oauth/pkce";
import { createAuthorizationCode, exchangeAuthorizationCode } from "@/server/mcp/oauth/codes";
import { hashOAuthSecret } from "@/server/mcp/oauth/hash";
import { OAuthError } from "@/server/mcp/oauth/errors";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

describe("authorization codes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function seedConsumedCode(rawCode: string, verifier: string) {
    const challenge = computeS256Challenge(verifier);
    return createFakeAdmin({
      mcp_oauth_authorization_codes: [
        {
          id: "code-1",
          code_hash: hashOAuthSecret(rawCode),
          client_id: "sequrai-mcp-inspector",
          user_id: "user-1",
          organization_id: "org-1",
          redirect_uri: "http://127.0.0.1:6274/oauth/callback",
          code_challenge: challenge,
          code_challenge_method: "S256",
          scopes: ["mcp:status:read"],
          expires_at: new Date(Date.now() + 600_000).toISOString(),
          consumed_at: null,
        },
      ],
    });
  }

  it("creates single-use authorization codes", async () => {
    const admin = createFakeAdmin({ mcp_oauth_authorization_codes: [] });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const code = await createAuthorizationCode({
      clientId: "sequrai-mcp-inspector",
      userId: "user-1",
      organizationId: "org-1",
      redirectUri: "http://127.0.0.1:6274/oauth/callback",
      codeChallenge: computeS256Challenge(generateCodeVerifier()),
      codeChallengeMethod: "S256",
      scopes: ["mcp:status:read"],
    });

    expect(code.length).toBeGreaterThan(20);
  });

  it("exchanges a valid code once", async () => {
    const verifier = generateCodeVerifier();
    const rawCode = "test-auth-code-value";
    const admin = await seedConsumedCode(rawCode, verifier);
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const record = await exchangeAuthorizationCode({
      code: rawCode,
      clientId: "sequrai-mcp-inspector",
      redirectUri: "http://127.0.0.1:6274/oauth/callback",
      codeVerifier: verifier,
    });

    expect(record.organization_id).toBe("org-1");
  });

  it("rejects replay of consumed code", async () => {
    const verifier = generateCodeVerifier();
    const rawCode = "replay-code";
    const admin = await seedConsumedCode(rawCode, verifier);
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    await exchangeAuthorizationCode({
      code: rawCode,
      clientId: "sequrai-mcp-inspector",
      redirectUri: "http://127.0.0.1:6274/oauth/callback",
      codeVerifier: verifier,
    });

    await expect(
      exchangeAuthorizationCode({
        code: rawCode,
        clientId: "sequrai-mcp-inspector",
        redirectUri: "http://127.0.0.1:6274/oauth/callback",
        codeVerifier: verifier,
      })
    ).rejects.toThrow(OAuthError);
  });

  it("rejects expired code", async () => {
    const verifier = generateCodeVerifier();
    const rawCode = "expired-code";
    const admin = createFakeAdmin({
      mcp_oauth_authorization_codes: [
        {
          id: "code-1",
          code_hash: hashOAuthSecret(rawCode),
          client_id: "sequrai-mcp-inspector",
          user_id: "user-1",
          organization_id: "org-1",
          redirect_uri: "http://127.0.0.1:6274/oauth/callback",
          code_challenge: computeS256Challenge(verifier),
          code_challenge_method: "S256",
          scopes: ["mcp:status:read"],
          expires_at: new Date(Date.now() - 1_000).toISOString(),
          consumed_at: null,
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    await expect(
      exchangeAuthorizationCode({
        code: rawCode,
        clientId: "sequrai-mcp-inspector",
        redirectUri: "http://127.0.0.1:6274/oauth/callback",
        codeVerifier: verifier,
      })
    ).rejects.toThrow(OAuthError);
  });

  it("rejects wrong client", async () => {
    const verifier = generateCodeVerifier();
    const rawCode = "wrong-client";
    const admin = await seedConsumedCode(rawCode, verifier);
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    await expect(
      exchangeAuthorizationCode({
        code: rawCode,
        clientId: "other-client",
        redirectUri: "http://127.0.0.1:6274/oauth/callback",
        codeVerifier: verifier,
      })
    ).rejects.toThrow(OAuthError);
  });

  it("rejects wrong redirect uri", async () => {
    const verifier = generateCodeVerifier();
    const rawCode = "wrong-redirect";
    const admin = await seedConsumedCode(rawCode, verifier);
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    await expect(
      exchangeAuthorizationCode({
        code: rawCode,
        clientId: "sequrai-mcp-inspector",
        redirectUri: "http://127.0.0.1:9999/oauth/callback",
        codeVerifier: verifier,
      })
    ).rejects.toThrow(OAuthError);
  });

  it("rejects wrong verifier", async () => {
    const verifier = generateCodeVerifier();
    const rawCode = "wrong-verifier";
    const admin = await seedConsumedCode(rawCode, verifier);
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    await expect(
      exchangeAuthorizationCode({
        code: rawCode,
        clientId: "sequrai-mcp-inspector",
        redirectUri: "http://127.0.0.1:6274/oauth/callback",
        codeVerifier: generateCodeVerifier(),
      })
    ).rejects.toThrow(OAuthError);
  });
});
