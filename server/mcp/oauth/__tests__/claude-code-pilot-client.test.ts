import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { redirectUriExactMatch } from "../redirect-uri";

const sql = readFileSync("database/migrations/069_mcp_oauth_client_claude_code_pilot.sql", "utf8");
const REGISTERED = ["http://localhost:43871/callback"];

const code = sql.replace(/--.*$/gm, ""); // SQL without comments

describe("migration 069 registers exactly one public client with one exact loopback redirect", () => {
  it("inserts only the pilot client, public and active, with the single redirect URI", () => {
    expect([...code.matchAll(/insert into (\S+)/gi)].map((m) => m[1])).toEqual(["public.mcp_oauth_clients"]);
    expect(code).toContain("'sequrai-claude-code-pilot'");
    expect(code).toContain("'public'");
    expect(code).toContain("'active'");
    const uris = [...code.matchAll(/array\[([^\]]*)\]/gi)].flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
    expect(uris).toEqual(["http://localhost:43871/callback"]);
    expect(uris[0]).not.toMatch(/[*%?#]/); // no wildcard, query or fragment
    expect(code).toMatch(/on conflict \(client_id\) do nothing/i);
  });

  it("changes no existing data and no policy: no delete/update/alter/drop, no scopes, no dynamic registration", () => {
    expect(code).not.toMatch(/\b(delete|update|truncate|drop|alter)\b/i);
    expect(code).not.toMatch(/scopes|dcr|confidential/i);
  });

  it("the exact URI Claude Code sends is accepted; every near-miss is rejected", () => {
    expect(redirectUriExactMatch("http://localhost:43871/callback", REGISTERED)).toBe(true);
    for (const wrong of [
      "http://127.0.0.1:43871/callback", // the v2.1.229 form
      "http://localhost:43872/callback", // another port
      "http://localhost:43871/oauth/callback", // another path (the inspector's)
      "http://localhost:43871/callback/", // trailing slash
      "https://localhost:43871/callback", // scheme
      "http://localhost.evil.test:43871/callback", // look-alike host
      "http://localhost:43871/callback?x=1#frag".replace("?x=1#frag", "/../x"), // path escape
    ]) {
      expect(redirectUriExactMatch(wrong, REGISTERED), wrong).toBe(false);
    }
  });
});
