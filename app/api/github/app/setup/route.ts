import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { finalizeGitHubAppInstallation } from "@/server/github-app/installation-events";
import { assertWorkspaceMembership } from "@/server/workspaces/service";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { isGitHubAppConfigured } from "@/server/github-app/config";

export const runtime = "nodejs";

const STATE_COOKIE = "sequrai_github_app_install_state";

function verifySignedState(state: string, secret: string): { organizationId: string; userId: string } | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const separator = decoded.lastIndexOf(".");
    if (separator <= 0) return null;
    const payload = decoded.slice(0, separator);
    const signature = decoded.slice(separator + 1);
    const expected = createHmac("sha256", secret).update(payload).digest("hex");
    if (expected.length !== signature.length) return null;
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
    const parsed = JSON.parse(payload) as {
      organizationId?: string;
      userId?: string;
      exp?: number;
    };
    if (!parsed.organizationId || !parsed.userId || !parsed.exp) return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return { organizationId: parsed.organizationId, userId: parsed.userId };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const rateLimited = enforceRateLimit(request);
  if (rateLimited) return rateLimited;

  const trustedBase = process.env.NEXT_PUBLIC_APP_URL?.trim() || request.url;

  if (!isGitHubAppConfigured()) {
    return NextResponse.redirect(new URL("/integrations?githubApp=not_configured", trustedBase));
  }

  const auth = await getServerAuthContext();
  if (!auth) {
    return NextResponse.redirect(new URL("/login", trustedBase));
  }

  const url = new URL(request.url);
  const installationIdRaw = url.searchParams.get("installation_id");
  const setupAction = url.searchParams.get("setup_action");
  const stateParam = url.searchParams.get("state");

  const cookieStore = await cookies();
  const cookieState = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);

  const state = stateParam ?? cookieState;
  if (!installationIdRaw || !state) {
    return NextResponse.redirect(new URL("/integrations?githubApp=invalid_setup", trustedBase));
  }

  const githubInstallationId = Number.parseInt(installationIdRaw, 10);
  if (!Number.isFinite(githubInstallationId)) {
    return NextResponse.redirect(new URL("/integrations?githubApp=invalid_installation", trustedBase));
  }

  const secret =
    process.env.GITHUB_APP_STATE_SECRET?.trim() ??
    process.env.GITHUB_OAUTH_STATE_SECRET?.trim() ??
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret) {
    return NextResponse.redirect(new URL("/integrations?githubApp=internal_error", trustedBase));
  }

  const verified = verifySignedState(state, secret);
  if (!verified || verified.userId !== auth.user.id) {
    return NextResponse.redirect(new URL("/integrations?githubApp=state_mismatch", trustedBase));
  }

  const allowed = await assertWorkspaceMembership(
    auth.supabase,
    auth.user.id,
    verified.organizationId
  );
  if (!allowed || verified.organizationId !== auth.organizationId) {
    return NextResponse.redirect(new URL("/integrations?githubApp=workspace_denied", trustedBase));
  }

  const admin = createAdminClient();
  const result = await finalizeGitHubAppInstallation({
    admin,
    organizationId: verified.organizationId,
    githubInstallationId,
  });

  if (!result.ok) {
    return NextResponse.redirect(
      new URL(`/integrations?githubApp=${encodeURIComponent(result.code)}`, trustedBase)
    );
  }

  const redirect = new URL("/integrations", trustedBase);
  redirect.searchParams.set("githubApp", "installed");
  redirect.searchParams.set("repoCount", String(result.repositoryCount));
  if (setupAction) redirect.searchParams.set("setupAction", setupAction);
  return NextResponse.redirect(redirect);
}
