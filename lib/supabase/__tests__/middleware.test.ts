import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { updateSession } from "../middleware";

const getUser = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser },
  })),
}));

function request(path: string) {
  return new NextRequest(`https://app.example.com${path}`);
}

describe("updateSession", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    getUser.mockReset();
  });

  function stubSupabaseEnv() {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
  }

  it("redirects an unauthenticated user off a protected route to /login, preserving the intended destination", async () => {
    stubSupabaseEnv();
    getUser.mockResolvedValue({ data: { user: null } });

    const response = await updateSession(request("/projects/abc/mission-control"));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("redirectTo")).toBe("/projects/abc/mission-control");
  });

  it("lets an unauthenticated user through to a public route", async () => {
    stubSupabaseEnv();
    getUser.mockResolvedValue({ data: { user: null } });

    const response = await updateSession(request("/login"));

    expect(response.status).not.toBe(307);
  });

  it("redirects an authenticated user away from /login back to their intended destination", async () => {
    stubSupabaseEnv();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const response = await updateSession(
      request("/login?redirectTo=%2Fprojects%2Fabc%2Fmission-control")
    );

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/projects/abc/mission-control");
    expect(location.searchParams.has("redirectTo")).toBe(false);
  });

  it("falls back to the safe default when redirectTo is an absolute/external URL", async () => {
    stubSupabaseEnv();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const response = await updateSession(
      request("/login?redirectTo=" + encodeURIComponent("https://evil.example.com"))
    );

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.hostname).toBe("app.example.com");
    expect(location.pathname).toBe("/onboarding");
  });

  it("lets an authenticated user through to a protected route", async () => {
    stubSupabaseEnv();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const response = await updateSession(request("/dashboard"));

    expect(response.status).not.toBe(307);
  });
});
