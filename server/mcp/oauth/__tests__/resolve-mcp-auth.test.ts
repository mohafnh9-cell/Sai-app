import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashMcpApiKey, resolveMcpAuth } from "@/server/mcp/auth";
import { hashOAuthSecret, generateOAuthSecret } from "@/server/mcp/oauth/hash";
import { ACCESS_TOKEN_PREFIX } from "@/server/mcp/oauth/types";
import { createFakeAdmin } from "@/server/mcp/__tests__/fake-admin";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

describe("resolveMcpAuth dual mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("authenticates legacy API keys unchanged", async () => {
    const rawKey = "seq_live_valid-key";
    const admin = createFakeAdmin({
      mcp_api_keys: [
        {
          id: "key-1",
          organization_id: "org-1",
          created_by_user_id: "user-1",
          key_hash: hashMcpApiKey(rawKey),
          revoked_at: null,
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const ctx = await resolveMcpAuth(
      new Request("https://sequrai.example/api/mcp", {
        headers: { authorization: `Bearer ${rawKey}` },
      })
    );

    expect(ctx).toMatchObject({
      authType: "api_key",
      source: "legacy_api_key",
      organizationId: "org-1",
      keyId: "key-1",
    });
    expect(ctx?.scopes.length).toBeGreaterThan(0);
  });

  it("authenticates OAuth access tokens", async () => {
    const rawToken = generateOAuthSecret(ACCESS_TOKEN_PREFIX);
    const admin = createFakeAdmin({
      mcp_oauth_access_tokens: [
        {
          id: "tok-1",
          token_hash: hashOAuthSecret(rawToken),
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

    const ctx = await resolveMcpAuth(
      new Request("https://sequrai.example/api/mcp", {
        headers: { authorization: `Bearer ${rawToken}` },
      })
    );

    expect(ctx).toMatchObject({
      authType: "oauth",
      source: "oauth_token",
      tokenId: "tok-1",
      clientId: "sequrai-mcp-inspector",
      organizationId: "org-1",
    });
  });

  it("rejects revoked OAuth token", async () => {
    const rawToken = generateOAuthSecret(ACCESS_TOKEN_PREFIX);
    const admin = createFakeAdmin({
      mcp_oauth_access_tokens: [
        {
          id: "tok-1",
          token_hash: hashOAuthSecret(rawToken),
          client_id: "sequrai-mcp-inspector",
          user_id: "user-1",
          organization_id: "org-1",
          scopes: ["mcp:status:read"],
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          revoked_at: new Date().toISOString(),
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    await expect(
      resolveMcpAuth(
        new Request("https://sequrai.example/api/mcp", {
          headers: { authorization: `Bearer ${rawToken}` },
        })
      )
    ).resolves.toBeNull();
  });

  it("rejects unknown bearer tokens", async () => {
    const admin = createFakeAdmin({});
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    await expect(
      resolveMcpAuth(
        new Request("https://sequrai.example/api/mcp", {
          headers: { authorization: "Bearer unknown-token" },
        })
      )
    ).resolves.toBeNull();
  });
});
