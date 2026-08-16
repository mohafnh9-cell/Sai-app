import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createFakeAdmin } from "@/server/mcp/__tests__/fake-admin";
import { hashOAuthSecret, generateOAuthSecret } from "@/server/mcp/oauth/hash";
import { ACCESS_TOKEN_PREFIX } from "@/server/mcp/oauth/types";
import { assertToolScope } from "@/server/mcp/oauth/scopes";
import { testOAuthMcpAuthContext } from "@/server/mcp/__tests__/test-context";
import { McpError } from "@/server/mcp/auth";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

describe("OAuth MCP integration (scope gate)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows can_i_deploy with mcp:status:read scope", () => {
    const admin = createFakeAdmin({});
    const ctx = testOAuthMcpAuthContext(admin, { scopes: ["mcp:status:read"] });
    expect(() => assertToolScope(ctx, "can_i_deploy")).not.toThrow();
  });

  it("blocks full_product_audit without mcp:audit:run", () => {
    const admin = createFakeAdmin({});
    const ctx = testOAuthMcpAuthContext(admin, { scopes: ["mcp:status:read"] });
    expect(() => assertToolScope(ctx, "full_product_audit")).toThrow(McpError);
  });

  it("resolves OAuth bearer for MCP route auth path", async () => {
    const rawToken = generateOAuthSecret(ACCESS_TOKEN_PREFIX);
    const admin = createFakeAdmin({
      mcp_oauth_access_tokens: [
        {
          id: "tok-1",
          token_hash: hashOAuthSecret(rawToken),
          client_id: "sequrai-mcp-inspector",
          user_id: "user-1",
          organization_id: "org-1",
          scopes: ["mcp:status:read", "mcp:audit:run"],
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          revoked_at: null,
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const { resolveMcpAuth } = await import("@/server/mcp/auth");
    const ctx = await resolveMcpAuth(
      new Request("https://sequrai.example/api/mcp", {
        headers: { authorization: `Bearer ${rawToken}` },
      })
    );

    expect(ctx?.authType).toBe("oauth");
    expect(() => assertToolScope(ctx!, "can_i_deploy")).not.toThrow();
  });
});
