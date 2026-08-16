import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createFakeAdmin } from "@/server/mcp/__tests__/fake-admin";
import { hashOAuthSecret, generateOAuthSecret } from "@/server/mcp/oauth/hash";
import {
  issueTokenPair,
  refreshOAuthTokens,
  resolveOAuthAccessToken,
  revokeOAuthToken,
} from "@/server/mcp/oauth/tokens";
import { ACCESS_TOKEN_PREFIX, REFRESH_TOKEN_PREFIX } from "@/server/mcp/oauth/types";
import { OAuthError } from "@/server/mcp/oauth/errors";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

describe("OAuth tokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("issues access and refresh tokens", async () => {
    const admin = createFakeAdmin({
      mcp_oauth_access_tokens: [],
      mcp_oauth_refresh_tokens: [],
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const response = await issueTokenPair({
      clientId: "sequrai-mcp-inspector",
      userId: "user-1",
      organizationId: "org-1",
      scopes: ["mcp:status:read"],
    });

    expect(response.access_token.startsWith(ACCESS_TOKEN_PREFIX)).toBe(true);
    expect(response.refresh_token?.startsWith(REFRESH_TOKEN_PREFIX)).toBe(true);
    expect(response.token_type).toBe("Bearer");
  });

  it("resolves a valid access token", async () => {
    const raw = generateOAuthSecret(ACCESS_TOKEN_PREFIX);
    const admin = createFakeAdmin({
      mcp_oauth_access_tokens: [
        {
          id: "tok-1",
          token_hash: hashOAuthSecret(raw),
          client_id: "sequrai-mcp-inspector",
          user_id: "user-1",
          organization_id: "org-1",
          scopes: ["mcp:status:read"],
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          revoked_at: null,
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const record = await resolveOAuthAccessToken(raw);
    expect(record?.organization_id).toBe("org-1");
  });

  it("rejects expired access token", async () => {
    const raw = generateOAuthSecret(ACCESS_TOKEN_PREFIX);
    const admin = createFakeAdmin({
      mcp_oauth_access_tokens: [
        {
          id: "tok-1",
          token_hash: hashOAuthSecret(raw),
          client_id: "sequrai-mcp-inspector",
          user_id: "user-1",
          organization_id: "org-1",
          scopes: ["mcp:status:read"],
          expires_at: new Date(Date.now() - 60_000).toISOString(),
          revoked_at: null,
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    await expect(resolveOAuthAccessToken(raw)).resolves.toBeNull();
  });

  it("rotates refresh token on refresh", async () => {
    const refreshRaw = generateOAuthSecret(REFRESH_TOKEN_PREFIX);
    const admin = createFakeAdmin({
      mcp_oauth_access_tokens: [],
      mcp_oauth_refresh_tokens: [
        {
          id: "rt-1",
          token_hash: hashOAuthSecret(refreshRaw),
          client_id: "sequrai-mcp-inspector",
          user_id: "user-1",
          organization_id: "org-1",
          scopes: ["mcp:status:read"],
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          revoked_at: null,
          family_id: "family-1",
          rotated_from: null,
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const response = await refreshOAuthTokens({
      refreshToken: refreshRaw,
      clientId: "sequrai-mcp-inspector",
    });

    expect(response.access_token.startsWith(ACCESS_TOKEN_PREFIX)).toBe(true);
    expect(response.refresh_token?.startsWith(REFRESH_TOKEN_PREFIX)).toBe(true);
  });

  it("detects refresh token reuse and revokes family", async () => {
    const refreshRaw = generateOAuthSecret(REFRESH_TOKEN_PREFIX);
    const admin = createFakeAdmin({
      mcp_oauth_access_tokens: [],
      mcp_oauth_refresh_tokens: [
        {
          id: "rt-1",
          token_hash: hashOAuthSecret(refreshRaw),
          client_id: "sequrai-mcp-inspector",
          user_id: "user-1",
          organization_id: "org-1",
          scopes: ["mcp:status:read"],
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          revoked_at: new Date().toISOString(),
          family_id: "family-1",
          rotated_from: null,
        },
        {
          id: "rt-2",
          token_hash: hashOAuthSecret(generateOAuthSecret(REFRESH_TOKEN_PREFIX)),
          client_id: "sequrai-mcp-inspector",
          user_id: "user-1",
          organization_id: "org-1",
          scopes: ["mcp:status:read"],
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          revoked_at: null,
          family_id: "family-1",
          rotated_from: "rt-1",
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    await expect(
      refreshOAuthTokens({ refreshToken: refreshRaw, clientId: "sequrai-mcp-inspector" })
    ).rejects.toThrow(OAuthError);
  });

  it("revokes access token without leaking existence", async () => {
    const raw = generateOAuthSecret(ACCESS_TOKEN_PREFIX);
    const admin = createFakeAdmin({
      mcp_oauth_access_tokens: [
        {
          id: "tok-1",
          token_hash: hashOAuthSecret(raw),
          client_id: "sequrai-mcp-inspector",
          user_id: "user-1",
          organization_id: "org-1",
          scopes: ["mcp:status:read"],
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          revoked_at: null,
        },
      ],
      mcp_oauth_refresh_tokens: [],
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    await revokeOAuthToken({ token: raw, tokenTypeHint: "access_token" });
    const resolved = await resolveOAuthAccessToken(raw);
    expect(resolved).toBeNull();
  });
});
