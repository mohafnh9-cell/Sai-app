import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// /oauth/authorize and the consent screen must never act as a redirector: an error (or a code) goes to a callback only
// when the client is ACTIVE and that exact redirect_uri is registered for it. Everything else is answered locally.

const fake = vi.hoisted(() => ({ admin: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake.admin }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "Sequrai" } }) }) }) }),
  }),
}));
vi.mock("@/server/workspaces/service", () => ({ resolveActiveWorkspaceIdForUser: async () => "org-sequrai" }));
vi.mock("@/server/http/rate-limit", () => ({ enforceRateLimit: async () => null }));

import { GET as authorize } from "@/app/oauth/authorize/route";
import { POST as consent } from "@/app/api/oauth/consent/route";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";

const APP = "https://app.example";
const CLIENT = "sequrai-claude-code-pilot";
const REGISTERED = "http://localhost:43871/callback";
const READ = "mcp:status:read mcp:discover:read mcp:fix:read";
const challenge = createHash("sha256").update(randomBytes(32).toString("base64url")).digest("base64url");

let tables: FakeTables;

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = APP;
  tables = {
    mcp_oauth_clients: [
      { client_id: CLIENT, client_name: "Claude Code (pilot)", client_type: "public", redirect_uris: [REGISTERED], status: "active" },
      { client_id: "retired-client", client_name: "Retired", client_type: "public", redirect_uris: ["http://localhost:50000/callback"], status: "disabled" },
    ],
    mcp_oauth_authorization_requests: [], mcp_oauth_authorization_codes: [], mcp_oauth_access_tokens: [], mcp_oauth_refresh_tokens: [],
    projects: [], profiles: [],
  } as unknown as FakeTables;
  fake.admin = createFakeAdmin(tables);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const start = (params: Record<string, string>) =>
  authorize(new Request(`${APP}/oauth/authorize?${new URLSearchParams({
    response_type: "code", client_id: CLIENT, redirect_uri: REGISTERED, code_challenge: challenge, code_challenge_method: "S256", scope: READ, state: "st-1", ...params,
  })}`));

async function expectLocalError(response: Response, error: string, status: number) {
  expect(response.headers.get("location")).toBeNull();
  expect(response.status).toBe(status);
  expect((await response.json()).error).toBe(error);
}

describe("/oauth/authorize never redirects to an untrusted callback", () => {
  it("an external URI that is not registered for an active client is answered locally", async () => {
    await expectLocalError(await start({ redirect_uri: "https://evil.example/cb" }), "invalid_redirect_uri", 400);
  });

  it("localhost with the wrong port, path or scheme is answered locally", async () => {
    for (const uri of ["http://localhost:43872/callback", "http://localhost:43871/oauth/callback", "https://localhost:43871/callback", "http://127.0.0.1:43871/callback"]) {
      await expectLocalError(await start({ redirect_uri: uri }), "invalid_redirect_uri", 400);
    }
  });

  it("a disabled client is answered locally even with the URI it had registered", async () => {
    await expectLocalError(await start({ client_id: "retired-client", redirect_uri: "http://localhost:50000/callback" }), "invalid_client", 401);
  });

  it("an unknown client is answered locally", async () => {
    await expectLocalError(await start({ client_id: "nobody", redirect_uri: "https://evil.example/cb" }), "invalid_client", 401);
  });

  it("a client disabled after registration is answered locally (the status, not the row, decides)", async () => {
    (tables.mcp_oauth_clients as Array<Record<string, unknown>>)[0].status = "disabled";
    await expectLocalError(await start({}), "invalid_client", 401);
  });

  it("controls: a valid client and URI still reach the consent screen, and a later error still goes to the validated callback", async () => {
    const ok = await start({});
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toContain("/settings/oauth/consent");

    const badScope = await start({ scope: "nothing:valid" });
    expect(badScope.status).toBe(302);
    const target = new URL(badScope.headers.get("location") as string);
    expect(`${target.origin}${target.pathname}`).toBe(REGISTERED);
    expect(target.searchParams.get("error")).toBe("invalid_scope");
    expect(target.searchParams.get("state")).toBe("st-1");
  });
});

describe("the consent screen re-validates the callback before using it", () => {
  const approve = (requestId: string) =>
    consent(new Request(`${APP}/api/oauth/consent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request_id: requestId, action: "approve" }) }));
  const deny = (requestId: string) =>
    consent(new Request(`${APP}/api/oauth/consent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request_id: requestId, action: "deny" }) }));

  async function pendingRequestId() {
    const response = await start({});
    return new URL(response.headers.get("location") as string).searchParams.get("request_id") as string;
  }

  it("controls: while the client is active, approve returns a code for the registered callback", async () => {
    const body = await (await approve(await pendingRequestId())).json();
    const target = new URL(body.redirectTo);
    expect(`${target.origin}${target.pathname}`).toBe(REGISTERED);
    expect(target.searchParams.get("code")).toBeTruthy();
  });

  it("approve after the client was disabled returns no redirect and issues no code", async () => {
    const id = await pendingRequestId();
    (tables.mcp_oauth_clients as Array<Record<string, unknown>>)[0].status = "disabled";
    const response = await approve(id);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("invalid_client");
    expect(body.redirectTo).toBeUndefined();
    expect(tables.mcp_oauth_authorization_codes).toHaveLength(0);
    expect(tables.mcp_oauth_authorization_requests).toHaveLength(0);
  });

  it("deny after the client was disabled does not hand the callback an error either", async () => {
    const id = await pendingRequestId();
    (tables.mcp_oauth_clients as Array<Record<string, unknown>>)[0].status = "disabled";
    const body = await (await deny(id)).json();
    expect(body.redirectTo).toBeUndefined();
    expect(body.error).toBe("invalid_client");
  });

  it("approve after the registered URI changed returns no redirect and issues no code", async () => {
    const id = await pendingRequestId();
    (tables.mcp_oauth_clients as Array<Record<string, unknown>>)[0].redirect_uris = ["http://localhost:43999/callback"];
    const response = await approve(id);
    expect(response.status).toBe(400);
    expect((await response.json()).redirectTo).toBeUndefined();
    expect(tables.mcp_oauth_authorization_codes).toHaveLength(0);
  });
});
