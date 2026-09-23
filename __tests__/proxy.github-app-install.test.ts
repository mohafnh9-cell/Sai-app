import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { proxy } from "@/proxy";

/**
 * Root cause of the production GitHub App installation bug: GitHub Apps
 * redirect back to whatever "Setup URL" is configured in the App's own
 * GitHub settings (independent of any redirect_uri this app passes --
 * https://github.com/apps/<slug>/installations/new takes no such
 * parameter). If that Setup URL is misconfigured to the bare site root
 * instead of /api/github/app/setup, the installation callback
 * (installation_id + setup_action, optionally state) lands on "/", which
 * is a force-static route handler (app/route.ts) that unconditionally
 * serves the marketing landing page and silently discards every query
 * param -- finalizeGitHubAppInstallation() was never called, so the
 * installation was never persisted. proxy.ts already runs on every
 * request to "/" (its matcher excludes only static assets), so the fix
 * recognizes that exact callback shape there and forwards it to the real
 * handler, which performs its own full auth/state/workspace validation.
 */
vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: vi.fn(async () => NextResponse.next()),
}));

vi.mock("@/server/http/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => null),
}));

function requestTo(url: string) {
  return new NextRequest(url);
}

describe("proxy: GitHub App installation callback forwarding", () => {
  it("forwards a GitHub App installation callback landing on the root to /api/github/app/setup", async () => {
    const res = await proxy(
      requestTo("https://sequrai-app.vercel.app/?installation_id=42&setup_action=install&state=abc")
    );

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/api/github/app/setup");
    expect(location.searchParams.get("installation_id")).toBe("42");
    expect(location.searchParams.get("setup_action")).toBe("install");
    expect(location.searchParams.get("state")).toBe("abc");
  });

  it("preserves setup_action=update on the forwarded request", async () => {
    const res = await proxy(
      requestTo("https://sequrai-app.vercel.app/?installation_id=42&setup_action=update")
    );

    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/api/github/app/setup");
    expect(location.searchParams.get("setup_action")).toBe("update");
  });

  it("does not redirect when installation_id is present without setup_action", async () => {
    const res = await proxy(requestTo("https://sequrai-app.vercel.app/?installation_id=42"));

    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
  });

  it("does not redirect when setup_action is present without installation_id", async () => {
    const res = await proxy(requestTo("https://sequrai-app.vercel.app/?setup_action=install"));

    expect(res.headers.get("location")).toBeNull();
  });

  it("does not redirect a plain root request with no query params (the normal, high-traffic case)", async () => {
    const res = await proxy(requestTo("https://sequrai-app.vercel.app/"));

    expect(res.headers.get("location")).toBeNull();
  });

  it("does not intercept installation_id/setup_action on a non-root path (only the misrouted case at '/' needs forwarding)", async () => {
    const res = await proxy(
      requestTo("https://sequrai-app.vercel.app/integrations?installation_id=42&setup_action=install")
    );

    expect(res.headers.get("location")).toBeNull();
  });
});
