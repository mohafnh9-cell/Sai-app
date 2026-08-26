import { NextResponse } from "next/server";
import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { getGitHubAppInstallUrl, isGitHubAppConfigured } from "@/server/github-app/config";
import { assertWorkspaceMembership } from "@/server/workspaces/service";
import { enforceRateLimit } from "@/server/http/rate-limit";

export const runtime = "nodejs";

const STATE_COOKIE = "sequrai_github_app_install_state";
const STATE_TTL_SECONDS = 900;

function signState(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export async function GET(request: Request) {
  const rateLimited = await enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  if (!isGitHubAppConfigured()) {
    return NextResponse.json(
      { error: "GitHub App is not configured", code: "github_app_not_configured" },
      { status: 503 }
    );
  }

  const auth = await getServerAuthContext();
  if (!auth?.organizationId) {
    return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
  }

  const allowed = await assertWorkspaceMembership(
    auth.supabase,
    auth.user.id,
    auth.organizationId
  );
  if (!allowed) {
    return NextResponse.json({ error: "Workspace access denied", code: "workspace_access_denied" }, {
      status: 403,
    });
  }

  const secret =
    process.env.GITHUB_APP_STATE_SECRET?.trim() ??
    process.env.GITHUB_OAUTH_STATE_SECRET?.trim() ??
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret) {
    return NextResponse.json({ error: "Install state secret missing", code: "internal_error" }, {
      status: 500,
    });
  }

  const nonce = randomBytes(16).toString("hex");
  const exp = Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS;
  const payload = JSON.stringify({
    organizationId: auth.organizationId,
    userId: auth.user.id,
    exp,
    nonce,
  });
  const signature = signState(payload, secret);
  const state = Buffer.from(`${payload}.${signature}`).toString("base64url");

  const installUrl = getGitHubAppInstallUrl(state);
  if (!installUrl) {
    return NextResponse.json({ error: "GitHub App install URL unavailable", code: "internal_error" }, {
      status: 500,
    });
  }

  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  });

  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/html")) {
    return NextResponse.redirect(installUrl);
  }

  return NextResponse.json({ installUrl, configured: true });
}
