import { beforeEach, describe, expect, it, vi } from "vitest";

// Workspace context for writes (PR #92): the request states the workspace the tab SHOWS. The write must be associated with exactly that
// workspace, or be rejected with nothing changed -- never redirected to whichever workspace is active at that instant.
const A = "workspace-a";
const B = "workspace-b";
const state = {
  active: A as string,
  member: new Set([A, B]),
  inserted: [] as Array<Record<string, unknown>>,
  revoked: [] as Array<{ id: string; org: string }>,
};

vi.mock("@/server/http/rate-limit", () => ({ enforceRateLimit: async () => null }));
vi.mock("@/server/mcp/auth", () => ({ generateMcpApiKey: () => ({ rawKey: "raw", prefix: "pre", hash: "hash" }) }));
vi.mock("@/server/workspaces/service", () => ({
  resolveActiveWorkspaceIdForUser: vi.fn(async () => state.active),
  assertWorkspaceMembership: vi.fn(async (_s: unknown, _u: unknown, ws: string) => state.member.has(ws)),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        state.inserted.push(row);
        return { select: () => ({ single: async () => ({ data: { id: "k1", name: row.name, key_prefix: "pre", created_at: "t" }, error: null }) }) };
      },
    }),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: () => {
      const q: { id?: string; org?: string } = {};
      const chain = {
        update: () => chain,
        eq: (col: string, v: string) => { if (col === "id") q.id = v; if (col === "organization_id") q.org = v; return chain; },
        is: async () => { state.revoked.push({ id: q.id!, org: q.org! }); return { error: null }; },
      };
      return chain;
    },
  }),
}));

import { POST, DELETE } from "../route";

const post = (shown: string | null, name = "Cursor") =>
  new Request("https://x/api/mcp/keys", { method: "POST", headers: { "content-type": "application/json", ...(shown ? { "x-sequrai-workspace-id": shown } : {}) }, body: JSON.stringify({ name }) });
const del = (shown: string | null) =>
  new Request("https://x/api/mcp/keys?id=key-1", { method: "DELETE", headers: shown ? { "x-sequrai-workspace-id": shown } : {} });

beforeEach(() => { state.active = A; state.member = new Set([A, B]); state.inserted = []; state.revoked = []; });

describe("POST /api/mcp/keys workspace context", () => {
  it("is associated with the shown workspace when it is the active one", async () => {
    const res = await POST(post(A));
    expect(res.status).toBe(200);
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]!.organization_id).toBe(A);
  });

  it("stale tab (shows A, another tab switched to B): 409, nothing written, no redirect to B", async () => {
    state.active = B;
    const res = await POST(post(A));
    expect(res.status).toBe(409);
    expect(res.headers.get("location")).toBeNull();
    const body = await res.json();
    expect(body).toMatchObject({ code: "workspace_context_mismatch", requestedWorkspaceId: A, activeWorkspaceId: B });
    expect(state.inserted).toHaveLength(0);
  });

  it("request in flight when the other tab switched: whichever side of the switch it lands, it is never written to the other workspace", async () => {
    // landed before the switch: written to the workspace it showed
    await POST(post(A));
    expect(state.inserted.map((r) => r.organization_id)).toEqual([A]);
    // landed after the switch: rejected
    state.active = B;
    const late = await POST(post(A));
    expect(late.status).toBe(409);
    expect(state.inserted.map((r) => r.organization_id)).toEqual([A]);
  });

  it("without a stated workspace: 400, nothing written (the mutable preference alone is not enough)", async () => {
    const res = await POST(post(null));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("workspace_context_required");
    expect(state.inserted).toHaveLength(0);
  });

  it("a workspace the user does not belong to: 403, nothing written", async () => {
    state.member = new Set([A]);
    state.active = A;
    const res = await POST(post(B));
    expect(res.status).toBe(403);
    expect(state.inserted).toHaveLength(0);
  });
});

describe("DELETE /api/mcp/keys workspace context", () => {
  it("revokes within the shown workspace", async () => {
    const res = await DELETE(del(A));
    expect(res.status).toBe(200);
    expect(state.revoked).toEqual([{ id: "key-1", org: A }]);
  });
  it("stale tab: 409 and nothing revoked", async () => {
    state.active = B;
    const res = await DELETE(del(A));
    expect(res.status).toBe(409);
    expect(state.revoked).toHaveLength(0);
  });
});
