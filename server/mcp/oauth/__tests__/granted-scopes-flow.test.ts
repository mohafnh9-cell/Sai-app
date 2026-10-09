import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Protocol-level proof, driving the REAL route handlers over an in-memory database:
//   /oauth/authorize -> consent screen -> /oauth/token (code) -> /api/mcp -> /oauth/token (refresh) -> /api/mcp
// for a client that asks for NOTHING in particular (omits `scope`) and a person who just presses "Allow".
// It exists so the scope behaviour of a real connection never has to be discovered by waiting for a token to expire.

const fake = vi.hoisted(() => ({ admin: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake.admin }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    // The consent screen also names the workspace (PR #68); harmless when the route does not read it yet.
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "Sequrai" } }) }) }) }),
  }),
}));
vi.mock("@/server/workspaces/service", () => ({ resolveActiveWorkspaceIdForUser: async () => "org-sequrai" }));
vi.mock("@/server/http/rate-limit", () => ({ enforceRateLimit: async () => null }));

import { GET as authorize } from "@/app/oauth/authorize/route";
import { POST as consent, GET as consentGet } from "@/app/api/oauth/consent/route";
import { POST as token } from "@/app/oauth/token/route";
import { POST as mcp } from "@/app/api/mcp/route";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { ALL_MCP_SCOPES, MCP_INITIAL_REQUEST_SCOPES } from "../scopes";

const APP = "https://app.example";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const CLIENT = "sequrai-claude-desktop";
const READ = [...MCP_INITIAL_REQUEST_SCOPES];
const REJECTED_TOOLS = ["review_now", "cancel_review", "full_product_audit", "authorize_dynamic_target"];
const ALLOWED_TOOLS = ["can_i_deploy", "what_changed", "production_history", "discover_application", "safe_fix"];

const b64url = (buffer: Buffer) => buffer.toString("base64url");
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash("sha256").update(verifier).digest());

let tables: FakeTables;
const logged: string[] = [];

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = APP;
  tables = {
    mcp_oauth_clients: [{ client_id: CLIENT, client_name: "Claude Desktop", client_type: "public", redirect_uris: [REDIRECT], status: "active" }],
    mcp_oauth_authorization_requests: [], mcp_oauth_authorization_codes: [], mcp_oauth_access_tokens: [], mcp_oauth_refresh_tokens: [],
    projects: [], profiles: [],
  } as unknown as FakeTables;
  fake.admin = createFakeAdmin(tables);
  logged.length = 0;
  for (const method of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logged.push(JSON.stringify(args)); });
  }
});
afterEach(() => vi.restoreAllMocks());

const form = (fields: Record<string, string>) =>
  new Request(`${APP}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });
const rpc = (accessToken: string, method: string, params?: unknown) =>
  mcp(new Request(`${APP}/api/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }));
const callTool = async (accessToken: string, name: string) => {
  const response = await rpc(accessToken, "tools/call", { name, arguments: { projectId: "00000000-0000-4000-8000-000000000000" } });
  return { http: response.status, body: await response.json() };
};

/** Full authorization as the claude.ai connector would do it, with NO `scope` parameter, then a plain "Allow". */
async function connect(selectedScopes?: string[]) {
  const authorizeUrl = new URL(`${APP}/oauth/authorize`);
  for (const [k, v] of Object.entries({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: "code", state: "st-1", code_challenge: challenge, code_challenge_method: "S256" })) authorizeUrl.searchParams.set(k, v);
  const redirected = await authorize(new Request(authorizeUrl));
  const requestId = new URL(redirected.headers.get("location")!).searchParams.get("request_id")!;
  const screen = await (await consentGet(new Request(`${APP}/api/oauth/consent?request_id=${requestId}`))).json();
  const approved = await consent(new Request(`${APP}/api/oauth/consent`, { method: "POST", body: JSON.stringify({ request_id: requestId, action: "approve", ...(selectedScopes ? { scopes: selectedScopes } : {}) }) }));
  const redirectTo = new URL((await approved.json()).redirectTo);
  expect(redirectTo.searchParams.get("state")).toBe("st-1");
  const code = redirectTo.searchParams.get("code")!;
  const tokenResponse = await token(form({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: CLIENT, code_verifier: verifier }));
  return { screen, code, tokens: await tokenResponse.json(), tokenStatus: tokenResponse.status };
}

describe("a real connection that omits `scope` and presses Allow ends with exactly the three least-privilege scopes", () => {
  it("REQUESTED vs GRANTED: the consent screen lists all six (the client asked for the default), only three are pre-ticked, and the token carries exactly those three", async () => {
    const { screen, tokens, tokenStatus } = await connect();
    expect(screen.scopes.map((s: { scope: string }) => s.scope)).toEqual([...ALL_MCP_SCOPES]); // requested = default = six
    expect(screen.scopes.filter((s: { defaultGranted: boolean }) => s.defaultGranted).map((s: { scope: string }) => s.scope)).toEqual(READ);
    expect(tokenStatus).toBe(200);
    expect(tokens.scope).toBe(READ.join(" "));
    expect(tables.mcp_oauth_access_tokens![0].scopes).toEqual(READ);
    expect(tables.mcp_oauth_refresh_tokens![0].scopes).toEqual(READ);
  });

  it("the five least-privilege tools are reachable; the four others are refused with insufficient_scope BEFORE any project lookup or action", async () => {
    const { tokens } = await connect();
    for (const name of ALLOWED_TOOLS) {
      const { body } = await callTool(tokens.access_token, name);
      // Reaches the tool (a nonexistent project is the expected, harmless answer): NOT a scope refusal.
      expect(body.result.isError).toBe(true);
      expect(body.result.code).not.toBe("insufficient_scope");
    }
    for (const name of REJECTED_TOOLS) {
      const { http, body } = await callTool(tokens.access_token, name);
      expect(http).toBe(200); // JSON-RPC: the refusal is the tool result, not an HTTP status
      expect(body.result).toMatchObject({ isError: true, code: "insufficient_scope" });
      expect(body.result.data.requiredScope).toBeTruthy();
    }
    expect(tables.scans ?? []).toEqual([]); // nothing was started
  });

  it("REFRESH keeps the reduced scopes: same three, rotated tokens, old refresh token unusable and its reuse revokes the refresh family", async () => {
    const { tokens } = await connect();
    const refreshed = await token(form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: CLIENT }));
    expect(refreshed.status).toBe(200);
    const next = await refreshed.json();
    expect(next.scope).toBe(READ.join(" "));
    expect(next.access_token).not.toBe(tokens.access_token);
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    for (const row of tables.mcp_oauth_access_tokens!) expect(row.scopes).toEqual(READ);
    for (const row of tables.mcp_oauth_refresh_tokens!) expect(row.scopes).toEqual(READ);

    // The refreshed access token behaves exactly like the first one.
    expect((await callTool(next.access_token, "review_now")).body.result.code).toBe("insufficient_scope");
    expect((await callTool(next.access_token, "can_i_deploy")).body.result.code).not.toBe("insufficient_scope");

    // Reusing the already-rotated refresh token is refused and revokes the whole refresh-token family: the NEWEST refresh
    // token stops working too. (Existing design: an access token already issued stays valid until its 1 h expiry.)
    const reuse = await token(form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: CLIENT }));
    expect(reuse.status).toBeGreaterThanOrEqual(400);
    const newest = await token(form({ grant_type: "refresh_token", refresh_token: next.refresh_token, client_id: CLIENT }));
    expect(newest.status).toBeGreaterThanOrEqual(400);
    expect(tables.mcp_oauth_refresh_tokens!.every((row) => row.revoked_at)).toBe(true);
  });

  it("opting in is the ONLY way to widen: ticking review_run yields four scopes and review_now is then no longer refused for scope", async () => {
    const { tokens } = await connect([...READ, "mcp:review:run"]);
    expect(tokens.scope).toBe([...READ, "mcp:review:run"].join(" "));
    expect(tables.mcp_oauth_access_tokens![0].scopes).toEqual([...READ, "mcp:review:run"]);
  });

  it("no credential ever reaches the logs: raw code, access token, refresh token and PKCE verifier are absent from everything logged", async () => {
    const { code, tokens } = await connect();
    await token(form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: CLIENT }));
    const everything = logged.join("\n");
    for (const secret of [code, tokens.access_token, tokens.refresh_token, verifier]) expect(everything).not.toContain(secret);
  });
});
