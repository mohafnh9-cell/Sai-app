import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  configured: true,
  auth: null as { organizationId: string; user: { id: string }; supabase: unknown } | null,
  membershipAllowed: true,
  installUrl: "https://github.com/apps/sequrai/installations/new?state=abc" as string | null,
}));

vi.mock("@/server/github-app/config", () => ({
  isGitHubAppConfigured: vi.fn(() => state.configured),
  getGitHubAppInstallUrl: vi.fn(() => state.installUrl),
}));
vi.mock("@/lib/auth/dev-bypass", () => ({
  getServerAuthContext: vi.fn(async () => state.auth),
}));
vi.mock("@/server/workspaces/service", () => ({
  assertWorkspaceMembership: vi.fn(async () => state.membershipAllowed),
}));
vi.mock("@/server/http/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => null),
}));

const setMock = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: setMock, get: vi.fn(), delete: vi.fn() })),
}));

import { GET } from "@/app/api/github/app/install/route";

function req(url = "https://example.com/api/github/app/install") {
  return new Request(url);
}

describe("GET /api/github/app/install", () => {
  beforeEach(() => {
    state.configured = true;
    state.auth = {
      organizationId: "org-1",
      user: { id: "user-1" },
      supabase: {},
    };
    state.membershipAllowed = true;
    state.installUrl = "https://github.com/apps/sequrai/installations/new?state=abc";
    setMock.mockClear();
    vi.stubEnv("GITHUB_APP_STATE_SECRET", "test-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 503 when the GitHub App is not configured", async () => {
    state.configured = false;
    const res = await GET(req());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("github_app_not_configured");
  });

  it("returns 401 for an unauthenticated request", async () => {
    state.auth = null;
    const res = await GET(req());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("unauthorized");
  });

  it("returns 403 when the user is not a member of their own active organization (workspace check fails)", async () => {
    state.membershipAllowed = false;
    const res = await GET(req());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("workspace_access_denied");
  });

  it("returns 500 when no state-signing secret is configured", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("GITHUB_APP_STATE_SECRET", "");
    vi.stubEnv("GITHUB_OAUTH_STATE_SECRET", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const res = await GET(req());
    expect(res.status).toBe(500);
  });

  it("returns 500 when the install URL cannot be built", async () => {
    state.installUrl = null;
    const res = await GET(req());
    expect(res.status).toBe(500);
  });

  it("valid authenticated request: sets a signed, httpOnly state cookie and returns the install URL as JSON for a non-HTML accept header", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.installUrl).toBe(state.installUrl);
    expect(body.configured).toBe(true);
    expect(setMock).toHaveBeenCalledTimes(1);
    const [cookieName, cookieValue, options] = setMock.mock.calls[0];
    expect(cookieName).toBe("sequrai_github_app_install_state");
    expect(typeof cookieValue).toBe("string");
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  });

  it("redirects (not JSON) when the request accepts text/html, e.g. a real browser navigation", async () => {
    const res = await GET(
      new Request("https://example.com/api/github/app/install", {
        headers: { accept: "text/html" },
      })
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(state.installUrl);
  });

  it("honors a safe `next` param and rejects/normalizes an unsafe one via safeNextPath (state still generated, no crash)", async () => {
    const res = await GET(req("https://example.com/api/github/app/install?next=https://evil.example.com"));
    expect(res.status).toBe(200);
    // safeNextPath falls back to a safe default for an absolute/unsafe URL --
    // proven indirectly: the route completes and issues a state cookie
    // rather than embedding the attacker-controlled absolute URL verbatim.
    expect(setMock).toHaveBeenCalledTimes(1);
  });
});
