import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { mcpUnauthorizedResponse } from "../errors";
import { ALL_MCP_SCOPES, MCP_INITIAL_REQUEST_SCOPES, parseScopeString, TOOL_REQUIRED_SCOPE } from "../scopes";

const OLD = process.env.NEXT_PUBLIC_APP_URL;
beforeEach(() => { process.env.NEXT_PUBLIC_APP_URL = "https://app.example"; });
afterEach(() => { process.env.NEXT_PUBLIC_APP_URL = OLD; });

describe("401 challenge advertises the least-privilege scopes to request first", () => {
  it("carries resource_metadata AND scope=<status, discover, fix:read>", () => {
    const header = mcpUnauthorizedResponse().headers.get("WWW-Authenticate") ?? "";
    expect(header).toContain('resource_metadata="https://app.example/.well-known/oauth-protected-resource"');
    expect(header).toContain('scope="mcp:status:read mcp:discover:read mcp:fix:read"');
  });

  it("works without a configured app URL too", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(mcpUnauthorizedResponse().headers.get("WWW-Authenticate")).toContain('scope="mcp:status:read mcp:discover:read mcp:fix:read"');
  });

  it("the hint contains no scope that runs reviews or audits or authorizes dynamic targets", () => {
    for (const forbidden of ["mcp:review:run", "mcp:audit:run", "mcp:target:authorize"]) {
      expect(MCP_INITIAL_REQUEST_SCOPES).not.toContain(forbidden);
    }
    expect(MCP_INITIAL_REQUEST_SCOPES.every((scope) => ALL_MCP_SCOPES.includes(scope))).toBe(true);
  });

  it("with those scopes a token reaches exactly the read tools and nothing that starts work", () => {
    const reachable = Object.entries(TOOL_REQUIRED_SCOPE).filter(([, scope]) => MCP_INITIAL_REQUEST_SCOPES.includes(scope)).map(([tool]) => tool).sort();
    expect(reachable).toEqual(["can_i_deploy", "discover_application", "production_history", "safe_fix", "what_changed"]);
  });

  it("compatibility is unchanged: omitting scope on /oauth/authorize still means all scopes; unknown scopes are rejected", () => {
    expect(parseScopeString(undefined)).toEqual([...ALL_MCP_SCOPES]);
    expect(parseScopeString("mcp:status:read mcp:nope")).toEqual([]);
    expect(parseScopeString("mcp:status:read mcp:discover:read mcp:fix:read")).toEqual([...MCP_INITIAL_REQUEST_SCOPES]);
  });
});
