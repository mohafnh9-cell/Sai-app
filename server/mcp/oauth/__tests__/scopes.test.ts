import { describe, expect, it } from "vitest";
import {
  ALL_MCP_SCOPES,
  TOOL_REQUIRED_SCOPE,
  assertToolScope,
} from "@/server/mcp/oauth/scopes";
import { MCP_PUBLIC_TOOL_NAMES } from "@/server/mcp/tool-definitions";
import { McpError } from "@/server/mcp/auth";
import { testOAuthMcpAuthContext } from "@/server/mcp/__tests__/test-context";
import { createFakeAdmin } from "@/server/mcp/__tests__/fake-admin";

describe("MCP OAuth scopes", () => {
  it("maps every public tool to exactly one scope", () => {
    for (const tool of MCP_PUBLIC_TOOL_NAMES) {
      expect(TOOL_REQUIRED_SCOPE[tool]).toBeTruthy();
    }
    expect(Object.keys(TOOL_REQUIRED_SCOPE)).toHaveLength(MCP_PUBLIC_TOOL_NAMES.length);
  });

  it("denies OAuth token without required scope", () => {
    const admin = createFakeAdmin({});
    const ctx = testOAuthMcpAuthContext(admin, { scopes: ["mcp:status:read"] });
    expect(() => assertToolScope(ctx, "full_product_audit")).toThrow(McpError);
  });

  it("allows legacy API key for all tools", () => {
    const admin = createFakeAdmin({});
    const ctx = testOAuthMcpAuthContext(admin, {
      authType: "api_key",
      source: "legacy_api_key",
      keyId: "key-1",
      tokenId: undefined,
      clientId: undefined,
    });
    for (const tool of MCP_PUBLIC_TOOL_NAMES) {
      expect(() => assertToolScope(ctx, tool)).not.toThrow();
    }
  });

  it("includes all mapped scopes in ALL_MCP_SCOPES", () => {
    const mapped = new Set(Object.values(TOOL_REQUIRED_SCOPE));
    for (const scope of mapped) {
      expect(ALL_MCP_SCOPES).toContain(scope);
    }
  });
});
