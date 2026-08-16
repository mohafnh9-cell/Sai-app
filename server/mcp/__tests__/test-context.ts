import type { McpAuthContext } from "@/server/mcp/auth";
import { ALL_MCP_SCOPES } from "@/server/mcp/oauth/scopes";
import type { createFakeAdmin } from "./fake-admin";

export function testMcpAuthContext(
  admin: ReturnType<typeof createFakeAdmin>,
  overrides: Partial<McpAuthContext> = {}
): McpAuthContext {
  return {
    authType: "api_key",
    keyId: "key-1",
    organizationId: "org-a",
    userId: "user-a",
    admin: admin as unknown as McpAuthContext["admin"],
    scopes: [...ALL_MCP_SCOPES],
    source: "legacy_api_key",
    ...overrides,
  };
}

export function testOAuthMcpAuthContext(
  admin: ReturnType<typeof createFakeAdmin>,
  overrides: Partial<McpAuthContext> = {}
): McpAuthContext {
  return testMcpAuthContext(admin, {
    authType: "oauth",
    keyId: undefined,
    tokenId: "token-1",
    clientId: "sequrai-mcp-inspector",
    source: "oauth_token",
    scopes: [...ALL_MCP_SCOPES],
    ...overrides,
  });
}
