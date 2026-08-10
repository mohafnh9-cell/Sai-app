import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  sessionClient: null as unknown,
  adminClient: null as unknown,
  inserted: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => state.sessionClient),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => state.adminClient),
}));
vi.mock("@/server/workspaces/service", () => ({
  resolveActiveWorkspaceIdForUser: vi.fn(async () => "org-1"),
}));
vi.mock("@/server/http/rate-limit", () => ({
  enforceRateLimit: vi.fn(() => null),
}));

import { GET, POST } from "@/app/api/mcp/keys/route";

function authenticatedClient(keys: Record<string, unknown>[] = []) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    is: vi.fn(() => query),
    order: vi.fn(async () => ({ data: keys, error: null })),
  };
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })) },
    from: vi.fn(() => query),
  };
}

function keyInsertClient() {
  const query = {
    insert: vi.fn((values: Record<string, unknown>) => {
      state.inserted = values;
      return query;
    }),
    select: vi.fn(() => query),
    single: vi.fn(async () => ({
      data: {
        id: "key-1",
        name: "Cursor Connection",
        key_prefix: state.inserted?.key_prefix,
        created_at: new Date().toISOString(),
      },
      error: null,
    })),
  };
  return { from: vi.fn(() => query) };
}

describe("MCP keys route", () => {
  beforeEach(() => {
    state.inserted = null;
    state.sessionClient = authenticatedClient();
    state.adminClient = keyInsertClient();
  });

  it("returns a new secret once while persisting only its hash and prefix", async () => {
    const response = await POST(
      new Request("https://sequrai.example/api/mcp/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Cursor Connection" }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.key.rawKey).toMatch(/^seq_live_/);
    expect(state.inserted).toMatchObject({
      organization_id: "org-1",
      created_by_user_id: "user-1",
      name: "Cursor Connection",
      key_prefix: body.key.rawKey.slice(0, 16),
    });
    expect(state.inserted).toHaveProperty("key_hash");
    expect(state.inserted).not.toHaveProperty("rawKey");
  });

  it("never returns secret material when listing existing keys", async () => {
    state.sessionClient = authenticatedClient([
      {
        id: "key-1",
        name: "Cursor Connection",
        key_prefix: "seq_live_example",
        last_used_at: null,
        revoked_at: null,
        created_at: new Date().toISOString(),
      },
    ]);

    const response = await GET(new Request("https://sequrai.example/api/mcp/keys"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.keys).toHaveLength(1);
    expect(JSON.stringify(body)).not.toMatch(/rawKey|key_hash|seq_live_[a-z0-9]{20,}/i);
  });
});
