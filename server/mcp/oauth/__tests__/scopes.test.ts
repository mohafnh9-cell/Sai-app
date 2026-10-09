import { describe, expect, it } from "vitest";
import {
  ALL_MCP_SCOPES,
  SENSITIVE_MCP_SCOPES,
  TOOL_REQUIRED_SCOPE,
  assertToolScope,
  resolveGrantedScopes,
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

describe("a connection granted exactly the three least-privilege scopes", () => {
  const READ = ["mcp:status:read", "mcp:discover:read", "mcp:fix:read"];
  const allowed = ["can_i_deploy", "what_changed", "production_history", "discover_application", "safe_fix"];
  const rejected = ["review_now", "cancel_review", "full_product_audit", "authorize_dynamic_target"];

  it("reaches exactly the five read tools and is rejected with 403 insufficient_scope (naming the missing scope) on the other four", () => {
    const ctx = testOAuthMcpAuthContext(createFakeAdmin({}), { scopes: READ });
    for (const tool of allowed) expect(() => assertToolScope(ctx, tool)).not.toThrow();
    for (const tool of rejected) {
      let caught: unknown;
      try { assertToolScope(ctx, tool); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(McpError);
      expect(caught).toMatchObject({ status: 403, code: "insufficient_scope", data: { requiredScope: TOOL_REQUIRED_SCOPE[tool] } });
    }
    expect([...allowed, ...rejected].sort()).toEqual([...MCP_PUBLIC_TOOL_NAMES].sort());
  });

  it("an unknown tool name is rejected as unknown, not allowed", () => {
    const ctx = testOAuthMcpAuthContext(createFakeAdmin({}), { scopes: READ });
    expect(() => assertToolScope(ctx, "run_shell")).toThrow(McpError);
  });
});

describe("resolveGrantedScopes", () => {
  const ALLSIX = [...ALL_MCP_SCOPES];
  it("no selection -> only the non-sensitive requested scopes", () => {
    expect(resolveGrantedScopes(ALLSIX)).toEqual(["mcp:status:read", "mcp:discover:read", "mcp:fix:read"]);
    expect(resolveGrantedScopes(["mcp:review:run", "mcp:status:read"])).toEqual(["mcp:status:read"]);
  });
  it("an explicit selection must be a non-empty subset of what was requested", () => {
    expect(resolveGrantedScopes(ALLSIX, ["mcp:review:run"])).toEqual(["mcp:review:run"]);
    expect(() => resolveGrantedScopes(["mcp:status:read"], ["mcp:audit:run"])).toThrow(McpError);
    expect(() => resolveGrantedScopes(ALLSIX, [])).toThrow(McpError);
    expect(() => resolveGrantedScopes(ALLSIX, ["nope"])).toThrow(McpError);
    expect(() => resolveGrantedScopes(["mcp:review:run"])).toThrow(McpError);
  });
  it("duplicates collapse; sensitivity is exactly review, audit and target authorization", () => {
    expect(resolveGrantedScopes(["mcp:status:read", "mcp:status:read"])).toEqual(["mcp:status:read"]);
    expect([...SENSITIVE_MCP_SCOPES].sort()).toEqual(["mcp:audit:run", "mcp:review:run", "mcp:target:authorize"]);
  });
});
