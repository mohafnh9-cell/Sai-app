import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/auth/callback/route";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/server/http/rate-limit";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/github/token-store", () => ({ saveGitHubToken: vi.fn() }));
vi.mock("@/server/github/workspace-connection-service", () => ({ upsertWorkspaceGitHubConnection: vi.fn() }));
vi.mock("@/server/workspaces/service", () => ({ assertWorkspaceMembership: vi.fn() }));
vi.mock("@/server/http/rate-limit", () => ({ enforceRateLimit: vi.fn() }));

const ORIGIN = "https://app.example.test";

function mockExchange(ok: boolean) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      exchangeCodeForSession: vi.fn().mockResolvedValue(
        ok
          ? { data: { session: { provider_token: null }, user: { id: "u1" } }, error: null }
          : { data: { session: null, user: null }, error: { code: "bad_code" } }
      ),
    },
  } as never);
}

function callback(opts: { cookieNext?: string; queryNext?: string; code?: string | null; error?: string } = {}) {
  const url = new URL(`${ORIGIN}/auth/callback`);
  if (opts.code !== null) url.searchParams.set("code", opts.code ?? "oauth-code");
  if (opts.queryNext !== undefined) url.searchParams.set("next", opts.queryNext);
  if (opts.error) url.searchParams.set("error", opts.error);
  return new NextRequest(url, {
    headers: opts.cookieNext === undefined ? {} : { cookie: `sequrai_auth_next=${encodeURIComponent(opts.cookieNext)}` },
  });
}

async function locationOf(request: NextRequest) {
  const response = await GET(request);
  return new URL(response.headers.get("location") as string);
}

beforeEach(() => {
  vi.mocked(enforceRateLimit).mockResolvedValue(null);
  mockExchange(true);
});

describe("auth callback: post-login destination (cookie transport, no destination in the callback URL)", () => {
  it("default login lands on the safe default", async () => {
    const to = await locationOf(callback());
    expect(to.origin).toBe(ORIGIN);
    expect(to.pathname).toBe("/onboarding");
  });

  it("an internal destination from the cookie is honored and the callback URL never contained it", async () => {
    const request = callback({ cookieNext: "/projects/123" });
    expect(request.url).not.toContain("projects");
    const to = await locationOf(request);
    expect(to.origin).toBe(ORIGIN);
    expect(`${to.pathname}${to.search}${to.hash}`).toBe("/projects/123");
  });

  it.each([
    "https://attacker.com",
    "//attacker.com",
    "/\\attacker.com",
    "/\\\\attacker.com",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "/\t/attacker.com",
    "/%5cattacker.com",
    "/%2fattacker.com",
    "/.//attacker.com",
  ])("a malicious cookie destination (%s) never leaves the origin and falls back", async (malicious) => {
    const to = await locationOf(callback({ cookieNext: malicious }));
    expect(to.origin).toBe(ORIGIN);
    expect(to.pathname).toBe("/onboarding");
    expect(to.hostname).not.toContain("attacker");
  });

  it("a malicious legacy ?next= fallback is rejected too", async () => {
    const to = await locationOf(callback({ queryNext: "/\\attacker.com" }));
    expect(to.origin).toBe(ORIGIN);
    expect(to.pathname).toBe("/onboarding");
  });

  it("a request without code or state falls back to login with an error, not to an attacker URL", async () => {
    const to = await locationOf(callback({ code: null, cookieNext: "https://attacker.com" }));
    expect(to.origin).toBe(ORIGIN);
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("error")).toBe("auth_callback_failed");
  });

  it("a provider error (user cancelled) never redirects to the requested destination", async () => {
    const to = await locationOf(callback({ code: null, error: "access_denied", cookieNext: "/\\attacker.com" }));
    expect(to.origin).toBe(ORIGIN);
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("error")).toBe("oauth_cancelled");
  });

  it("a failed code exchange (invalid / replayed code) goes to login, not to the destination", async () => {
    mockExchange(false);
    const to = await locationOf(callback({ cookieNext: "/projects/123" }));
    expect(to.origin).toBe(ORIGIN);
    expect(to.pathname).toBe("/login");
  });

  it("the destination cookie is cleared after a successful callback", async () => {
    const response = await GET(callback({ cookieNext: "/projects/123" }));
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("sequrai_auth_next=;");
  });
});
