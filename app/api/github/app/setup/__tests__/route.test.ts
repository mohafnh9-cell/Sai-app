import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "test-secret";
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const USER_1 = "user-1";

function signState(payload: Record<string, unknown>, secret = SECRET): string {
  const json = JSON.stringify(payload);
  const signature = createHmac("sha256", secret).update(json).digest("hex");
  return Buffer.from(`${json}.${signature}`).toString("base64url");
}

const state = vi.hoisted(() => ({
  configured: true,
  auth: null as { user: { id: string }; organizationId: string; supabase: unknown } | null,
  membershipAllowed: true,
  cookieState: undefined as string | undefined,
  finalizeResult: { ok: true, installationRowId: "row-1", repositoryCount: 3 } as
    | { ok: true; installationRowId: string; repositoryCount: number }
    | { ok: false; code: string; message: string },
}));

vi.mock("@/server/github-app/config", () => ({
  isGitHubAppConfigured: vi.fn(() => state.configured),
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
vi.mock("@/server/security-scanner/admin-client", () => ({
  createAdminClient: vi.fn(() => ({})),
}));
const finalizeMock = vi.fn(async (_input: unknown) => state.finalizeResult);
vi.mock("@/server/github-app/installation-events", () => ({
  finalizeGitHubAppInstallation: (input: unknown) => finalizeMock(input),
}));

const deleteMock = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn((name: string) => (name === "sequrai_github_app_install_state" && state.cookieState ? { value: state.cookieState } : undefined)),
    delete: deleteMock,
  })),
}));

import { GET } from "@/app/api/github/app/setup/route";

function req(query: string) {
  return new Request(`https://example.com/api/github/app/setup${query}`);
}

function locationParam(res: Response, key: string): string | null {
  const location = res.headers.get("location");
  if (!location) return null;
  return new URL(location).searchParams.get(key);
}

describe("GET /api/github/app/setup (installation callback)", () => {
  beforeEach(() => {
    state.configured = true;
    state.auth = { user: { id: USER_1 }, organizationId: ORG_A, supabase: {} };
    state.membershipAllowed = true;
    state.cookieState = undefined;
    state.finalizeResult = { ok: true, installationRowId: "row-1", repositoryCount: 3 };
    finalizeMock.mockClear();
    deleteMock.mockClear();
    vi.stubEnv("GITHUB_APP_STATE_SECRET", SECRET);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.sequrai.dev");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects with not_configured when the GitHub App isn't configured", async () => {
    state.configured = false;
    const res = await GET(req("?installation_id=1&state=x"));
    expect(locationParam(res, "githubApp")).toBe("not_configured");
  });

  it("redirects to /login for an unauthenticated request", async () => {
    state.auth = null;
    const res = await GET(req("?installation_id=1&state=x"));
    expect(res.headers.get("location")).toBe("https://app.sequrai.dev/login");
  });

  it("redirects with invalid_setup when installation_id is missing", async () => {
    const validState = signState({ organizationId: ORG_A, userId: USER_1, returnTo: "/integrations", exp: Math.floor(Date.now() / 1000) + 900 });
    const res = await GET(req(`?state=${validState}`));
    expect(locationParam(res, "githubApp")).toBe("invalid_setup");
  });

  it("redirects with invalid_setup when neither a state query param nor a state cookie is present", async () => {
    const res = await GET(req("?installation_id=42"));
    expect(locationParam(res, "githubApp")).toBe("invalid_setup");
  });

  it("falls back to the state cookie when no state query param is present (idempotent-friendly: GitHub's real redirect sometimes omits it)", async () => {
    state.cookieState = signState({
      organizationId: ORG_A,
      userId: USER_1,
      returnTo: "/integrations",
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    const res = await GET(req("?installation_id=42"));
    expect(locationParam(res, "githubApp")).toBe("installed");
    expect(deleteMock).toHaveBeenCalledWith("sequrai_github_app_install_state");
  });

  it("redirects with invalid_installation when installation_id is not a number", async () => {
    const validState = signState({ organizationId: ORG_A, userId: USER_1, returnTo: "/integrations", exp: Math.floor(Date.now() / 1000) + 900 });
    const res = await GET(req(`?installation_id=not-a-number&state=${validState}`));
    expect(locationParam(res, "githubApp")).toBe("invalid_installation");
  });

  it("redirects with state_mismatch when the state signature is invalid (tampered)", async () => {
    const tamperedState = signState(
      { organizationId: ORG_A, userId: USER_1, returnTo: "/integrations", exp: Math.floor(Date.now() / 1000) + 900 },
      "wrong-secret"
    );
    const res = await GET(req(`?installation_id=42&state=${tamperedState}`));
    expect(locationParam(res, "githubApp")).toBe("state_mismatch");
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("redirects with state_mismatch when the state has expired", async () => {
    const expiredState = signState({ organizationId: ORG_A, userId: USER_1, returnTo: "/integrations", exp: Math.floor(Date.now() / 1000) - 10 });
    const res = await GET(req(`?installation_id=42&state=${expiredState}`));
    expect(locationParam(res, "githubApp")).toBe("state_mismatch");
  });

  it("SECURITY: redirects with state_mismatch when the signed state's userId does not match the currently authenticated user (replay/session-confusion protection)", async () => {
    const otherUsersState = signState({
      organizationId: ORG_A,
      userId: "a-different-user",
      returnTo: "/integrations",
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    const res = await GET(req(`?installation_id=42&state=${otherUsersState}`));
    expect(locationParam(res, "githubApp")).toBe("state_mismatch");
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("SECURITY (tenant isolation): redirects with workspace_denied when the state's organizationId does not match the current user's active organization", async () => {
    const crossOrgState = signState({
      organizationId: ORG_B,
      userId: USER_1,
      returnTo: "/integrations",
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    // auth.organizationId is ORG_A (from beforeEach) -- state claims ORG_B.
    const res = await GET(req(`?installation_id=42&state=${crossOrgState}`));
    expect(locationParam(res, "githubApp")).toBe("workspace_denied");
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("redirects with workspace_denied when the user is not a member of the org named in the state", async () => {
    state.membershipAllowed = false;
    const validState = signState({ organizationId: ORG_A, userId: USER_1, returnTo: "/integrations", exp: Math.floor(Date.now() / 1000) + 900 });
    const res = await GET(req(`?installation_id=42&state=${validState}`));
    expect(locationParam(res, "githubApp")).toBe("workspace_denied");
  });

  it("valid installation flow: calls finalizeGitHubAppInstallation with the org from the verified state and redirects with installed + repoCount", async () => {
    const validState = signState({ organizationId: ORG_A, userId: USER_1, returnTo: "/integrations", exp: Math.floor(Date.now() / 1000) + 900 });
    const res = await GET(req(`?installation_id=42&setup_action=install&state=${validState}`));
    expect(finalizeMock).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_A, githubInstallationId: 42 })
    );
    expect(locationParam(res, "githubApp")).toBe("installed");
    expect(locationParam(res, "repoCount")).toBe("3");
    expect(locationParam(res, "setupAction")).toBe("install");
  });

  it("GitHub API failure mapping: redirects with the finalize failure code (e.g. installation_suspended) rather than a generic error", async () => {
    state.finalizeResult = { ok: false, code: "installation_suspended", message: "suspended" };
    const validState = signState({ organizationId: ORG_A, userId: USER_1, returnTo: "/integrations", exp: Math.floor(Date.now() / 1000) + 900 });
    const res = await GET(req(`?installation_id=42&state=${validState}`));
    expect(locationParam(res, "githubApp")).toBe("installation_suspended");
  });

  it("idempotent: calling the callback twice with the same valid state both times reaches finalizeGitHubAppInstallation and redirects success (upsert semantics live in finalize, not here)", async () => {
    const validState = signState({ organizationId: ORG_A, userId: USER_1, returnTo: "/integrations", exp: Math.floor(Date.now() / 1000) + 900 });
    const res1 = await GET(req(`?installation_id=42&state=${validState}`));
    const res2 = await GET(req(`?installation_id=42&state=${validState}`));
    expect(locationParam(res1, "githubApp")).toBe("installed");
    expect(locationParam(res2, "githubApp")).toBe("installed");
    expect(finalizeMock).toHaveBeenCalledTimes(2);
  });
});
