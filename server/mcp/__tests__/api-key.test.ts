import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateMcpApiKey,
  hashMcpApiKey,
  resolveMcpAuth,
} from "@/server/mcp/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createFakeAdmin } from "./fake-admin";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

describe("MCP API key auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("hashes keys deterministically", () => {
    const raw = "seq_live_abc123";
    expect(hashMcpApiKey(raw)).toBe(hashMcpApiKey(raw));
    expect(hashMcpApiKey(raw)).toHaveLength(64);
  });

  it("generates prefixed keys with matching hash", () => {
    const { rawKey, prefix, hash } = generateMcpApiKey();
    expect(rawKey.startsWith("seq_live_")).toBe(true);
    expect(prefix).toBe(rawKey.slice(0, 16));
    expect(hashMcpApiKey(rawKey)).toBe(hash);
  });

  it("generates unique keys", () => {
    const a = generateMcpApiKey();
    const b = generateMcpApiKey();
    expect(a.rawKey).not.toBe(b.rawKey);
  });

  it("authenticates a valid active key and preserves organization isolation", async () => {
    const rawKey = "seq_live_valid-key";
    const admin = createFakeAdmin({
      mcp_api_keys: [
        {
          id: "key-1",
          organization_id: "org-1",
          created_by_user_id: "user-1",
          key_hash: hashMcpApiKey(rawKey),
          revoked_at: null,
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const context = await resolveMcpAuth(
      new Request("https://sequrai.example/api/mcp", {
        headers: { authorization: `Bearer ${rawKey}` },
      })
    );

    expect(context).toMatchObject({
      authType: "api_key",
      source: "legacy_api_key",
      keyId: "key-1",
      organizationId: "org-1",
      userId: "user-1",
    });
  });

  it("rejects missing, invalid, and revoked keys", async () => {
    const revokedKey = "seq_live_revoked-key";
    const admin = createFakeAdmin({
      mcp_api_keys: [
        {
          id: "key-2",
          organization_id: "org-1",
          created_by_user_id: "user-1",
          key_hash: hashMcpApiKey(revokedKey),
          revoked_at: new Date().toISOString(),
        },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    await expect(resolveMcpAuth(new Request("https://sequrai.example/api/mcp"))).resolves.toBeNull();
    await expect(
      resolveMcpAuth(
        new Request("https://sequrai.example/api/mcp", {
          headers: { authorization: "Bearer wrong-prefix" },
        })
      )
    ).resolves.toBeNull();
    await expect(
      resolveMcpAuth(
        new Request("https://sequrai.example/api/mcp", {
          headers: { authorization: `Bearer ${revokedKey}` },
        })
      )
    ).resolves.toBeNull();
  });

  /**
   * Phase 4 hotfix: mcp_api_keys.first_used_at/last_used_at were written via
   * an un-awaited (`void ...`) update, which a Vercel serverless function
   * can drop the instant the HTTP response is sent -- proven live in
   * production, where the row never updated across two real authenticated
   * calls. The fix awaits the write; these tests lock in the surrounding
   * semantics so it can't silently regress back to fire-and-forget or start
   * failing valid calls when the write itself fails.
   */
  describe("usage timestamps (first_used_at / last_used_at)", () => {
    it("first authentication: writes both first_used_at and last_used_at", async () => {
      const rawKey = "seq_live_first-call-key";
      const tables = {
        mcp_api_keys: [
          {
            id: "key-3",
            organization_id: "org-1",
            created_by_user_id: "user-1",
            key_hash: hashMcpApiKey(rawKey),
            revoked_at: null,
            first_used_at: null,
            last_used_at: null,
          },
        ],
      };
      const admin = createFakeAdmin(tables);
      vi.mocked(createAdminClient).mockReturnValue(admin as never);

      await resolveMcpAuth(
        new Request("https://sequrai.example/api/mcp", {
          headers: { authorization: `Bearer ${rawKey}` },
        })
      );

      const row = tables.mcp_api_keys[0];
      expect(row.first_used_at).not.toBeNull();
      expect(row.last_used_at).not.toBeNull();
      expect(row.first_used_at).toBe(row.last_used_at);
    });

    it("second authentication: first_used_at stays put, last_used_at moves forward", async () => {
      const rawKey = "seq_live_second-call-key";
      const originalFirstUse = "2026-01-01T00:00:00.000Z";
      const tables = {
        mcp_api_keys: [
          {
            id: "key-4",
            organization_id: "org-1",
            created_by_user_id: "user-1",
            key_hash: hashMcpApiKey(rawKey),
            revoked_at: null,
            first_used_at: originalFirstUse,
            last_used_at: originalFirstUse,
          },
        ],
      };
      const admin = createFakeAdmin(tables);
      vi.mocked(createAdminClient).mockReturnValue(admin as never);

      await resolveMcpAuth(
        new Request("https://sequrai.example/api/mcp", {
          headers: { authorization: `Bearer ${rawKey}` },
        })
      );

      const row = tables.mcp_api_keys[0];
      expect(row.first_used_at).toBe(originalFirstUse);
      expect(row.last_used_at).not.toBe(originalFirstUse);
    });

    it("write failure: the update error never fails or nulls out an otherwise-valid auth result", async () => {
      const rawKey = "seq_live_write-fails-key";
      const row = {
        id: "key-5",
        organization_id: "org-1",
        created_by_user_id: "user-1",
        key_hash: hashMcpApiKey(rawKey),
        revoked_at: null,
        first_used_at: null,
      };
      // Minimal stand-in admin: the initial select resolves normally, but
      // the usage-timestamp update reports a Postgres-shaped error, exactly
      // like a real postgrest-js response never throws on a failed write.
      const admin = {
        from: (table: string) => {
          if (table !== "mcp_api_keys") throw new Error(`unexpected table ${table}`);
          return {
            select: () => ({
              eq: () => ({
                is: () => ({
                  maybeSingle: async () => ({ data: row, error: null }),
                }),
              }),
            }),
            update: () => ({
              eq: async () => ({ data: null, error: { message: "connection reset" } }),
            }),
          };
        },
      };
      vi.mocked(createAdminClient).mockReturnValue(admin as never);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const context = await resolveMcpAuth(
        new Request("https://sequrai.example/api/mcp", {
          headers: { authorization: `Bearer ${rawKey}` },
        })
      );

      expect(context).toMatchObject({ authType: "api_key", keyId: "key-5", organizationId: "org-1" });
      expect(errorSpy).toHaveBeenCalledWith(
        "mcp_api_keys usage timestamp update failed",
        expect.objectContaining({ keyId: "key-5" })
      );
      // The logged failure must never carry the raw key or any secret.
      const loggedArgs = errorSpy.mock.calls[0];
      expect(JSON.stringify(loggedArgs)).not.toContain(rawKey);

      errorSpy.mockRestore();
    });

    it("invalid API key: no row exists to update, so no write is attempted", async () => {
      const tables = { mcp_api_keys: [] as Record<string, unknown>[] };
      const admin = createFakeAdmin(tables);
      vi.mocked(createAdminClient).mockReturnValue(admin as never);

      const context = await resolveMcpAuth(
        new Request("https://sequrai.example/api/mcp", {
          headers: { authorization: "Bearer seq_live_never-issued" },
        })
      );

      expect(context).toBeNull();
      expect(tables.mcp_api_keys).toHaveLength(0);
    });

    it("unauthenticated request: resolveMcpAuth returns before touching the database at all", async () => {
      const admin = {
        from: () => {
          throw new Error("must not query anything for an unauthenticated request");
        },
      };
      vi.mocked(createAdminClient).mockReturnValue(admin as never);

      await expect(resolveMcpAuth(new Request("https://sequrai.example/api/mcp"))).resolves.toBeNull();
    });
  });
});
