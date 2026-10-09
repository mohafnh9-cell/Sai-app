import { beforeEach, describe, expect, it, vi } from "vitest";

const ALL = ["mcp:status:read", "mcp:discover:read", "mcp:fix:read", "mcp:review:run", "mcp:audit:run", "mcp:target:authorize"];
const READ = ["mcp:status:read", "mcp:discover:read", "mcp:fix:read"];

const state = vi.hoisted(() => ({
  requested: [] as string[],
  codeScopes: null as string[] | null,
  audit: [] as Array<Record<string, unknown>>,
  deleted: 0,
}));

vi.mock("@/server/http/rate-limit", () => ({ enforceRateLimit: async () => null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) } }),
}));
vi.mock("@/server/mcp/oauth/clients", () => ({ getOAuthClient: async () => ({ client_name: "Claude Code" }) }));
vi.mock("@/server/mcp/oauth/authorization-requests", () => ({
  getAuthorizationRequest: async () => ({
    id: "req-1", client_id: "client-1", user_id: "user-1", organization_id: "org-sequrai", redirect_uri: "http://127.0.0.1:1/cb", state: "st",
    code_challenge: "c".repeat(43), code_challenge_method: "S256", scopes: state.requested,
  }),
  deleteAuthorizationRequest: async () => { state.deleted += 1; },
}));
vi.mock("@/server/mcp/oauth/codes", () => ({ createAuthorizationCode: async (input: { scopes: string[] }) => { state.codeScopes = input.scopes; return "code-xyz"; } }));
vi.mock("@/server/mcp/oauth/audit", () => ({ logOAuthEvent: (event: Record<string, unknown>) => { state.audit.push(event); }, clientIp: () => "127.0.0.1" }));

import { GET, POST } from "../route";

const post = (body: unknown) => POST(new Request("http://x/api/oauth/consent", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => { state.requested = [...ALL]; state.codeScopes = null; state.audit = []; state.deleted = 0; });

describe("consent decides what is granted, not what the client asked for", () => {
  it("a client that asked for ALL six (or omitted scope) and a plain 'Allow' receives ONLY the three least-privilege scopes", async () => {
    const response = await post({ request_id: "req-1", action: "approve" });
    expect(response.status).toBe(200);
    expect(state.codeScopes).toEqual(READ);
    expect(state.audit.at(-1)).toMatchObject({ eventType: "oauth.authorization.completed", scopes: READ, metadata: { narrowed: true } });
  });

  it("the consent screen payload marks the three sensitive capabilities and leaves them unchecked by default", async () => {
    const response = await GET(new Request("http://x/api/oauth/consent?request_id=req-1"));
    const body = await response.json();
    const byScope = Object.fromEntries(body.scopes.map((s: { scope: string; sensitive: boolean; defaultGranted: boolean }) => [s.scope, s]));
    for (const scope of READ) expect(byScope[scope]).toMatchObject({ sensitive: false, defaultGranted: true });
    for (const scope of ["mcp:review:run", "mcp:audit:run", "mcp:target:authorize"]) expect(byScope[scope]).toMatchObject({ sensitive: true, defaultGranted: false });
  });

  it("the fix capability states that SequrAI saves a persistent proposal and does not change code or write to GitHub (en + es); no default capability is described as strictly read-only", async () => {
    const body = await (await GET(new Request("http://x/api/oauth/consent?request_id=req-1"))).json();
    const fix = body.scopes.find((item: { scope: string }) => item.scope === "mcp:fix:read");
    expect(fix.description).toMatch(/saves a persistent Safe Fix proposal/i);
    expect(fix.description).toMatch(/does not change your code or write to GitHub/i);
    expect(fix.descriptionEs).toMatch(/guarda una propuesta Safe Fix persistente/i);
    expect(fix.descriptionEs).toMatch(/no modifica tu c[oó]digo ni escribe en GitHub/i);
    for (const item of body.scopes) expect(`${item.description} ${item.descriptionEs}`).not.toMatch(/strictly read-only|solo lectura/i);
  });

  it("opting in is explicit: ticking a sensitive capability grants exactly the ticked set", async () => {
    await post({ request_id: "req-1", action: "approve", scopes: [...READ, "mcp:review:run"] });
    expect(state.codeScopes).toEqual([...READ, "mcp:review:run"]);
  });

  it("the person can grant even less than the default", async () => {
    await post({ request_id: "req-1", action: "approve", scopes: ["mcp:status:read"] });
    expect(state.codeScopes).toEqual(["mcp:status:read"]);
  });

  it.each([
    ["a scope that was not requested", ["mcp:status:read", "mcp:made:up"]],
    ["nothing selected", []],
  ])("%s -> 400 invalid_scope, no code issued, the request is kept", async (_label, scopes) => {
    const response = await post({ request_id: "req-1", action: "approve", scopes });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid_scope");
    expect(state.codeScopes).toBeNull();
    expect(state.deleted).toBe(0);
  });

  it("cannot grant a scope the client never requested, even a valid one", async () => {
    state.requested = [...READ];
    const response = await post({ request_id: "req-1", action: "approve", scopes: [...READ, "mcp:audit:run"] });
    expect(response.status).toBe(400);
    expect(state.codeScopes).toBeNull();
  });

  it("a client that requested only sensitive scopes gets nothing by default (400): the person must choose explicitly", async () => {
    state.requested = ["mcp:review:run"];
    expect((await post({ request_id: "req-1", action: "approve" })).status).toBe(400);
    expect(state.codeScopes).toBeNull();
    expect((await post({ request_id: "req-1", action: "approve", scopes: ["mcp:review:run"] })).status).toBe(200);
    expect(state.codeScopes).toEqual(["mcp:review:run"]);
  });

  it("deny is unchanged: no code, request deleted, access_denied redirect", async () => {
    const response = await post({ request_id: "req-1", action: "deny" });
    expect(response.status).toBe(200);
    expect((await response.json()).redirectTo).toContain("error=access_denied");
    expect(state.codeScopes).toBeNull();
    expect(state.deleted).toBe(1);
  });
});
