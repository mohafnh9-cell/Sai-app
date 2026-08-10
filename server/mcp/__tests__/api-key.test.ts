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
});
