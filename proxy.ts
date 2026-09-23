import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "@/lib/i18n/config";
import { detectLocaleFromAcceptLanguage } from "@/lib/i18n/detect";
import { enforceRateLimit } from "@/server/http/rate-limit";

/**
 * GitHub Apps redirect the browser back to whatever "Setup URL" is
 * configured in the App's own GitHub settings -- that destination is fixed
 * on GitHub's side, not something this app passes at install time
 * (https://github.com/apps/<slug>/installations/new takes no redirect
 * parameter, see getGitHubAppInstallUrl()). If that Setup URL is
 * misconfigured to the bare site root instead of /api/github/app/setup,
 * the installation callback (installation_id + setup_action, optionally
 * state) lands on "/", which is a force-static route handler
 * (app/route.ts) that unconditionally serves the marketing landing page
 * and silently ignores every query param -- finalizeGitHubAppInstallation
 * is never called, so the installation is never persisted, matching the
 * production symptom this fixes. Recognize that exact, unambiguous
 * callback shape here and forward it, unmodified, to the real handler,
 * which performs its own full signed-state, auth, and
 * workspace-membership validation -- nothing is duplicated or weakened.
 */
function githubAppInstallCallbackRedirect(request: NextRequest): NextResponse | null {
  if (request.nextUrl.pathname !== "/") return null;
  const { searchParams } = request.nextUrl;
  if (!searchParams.has("installation_id") || !searchParams.has("setup_action")) return null;

  const url = request.nextUrl.clone();
  url.pathname = "/api/github/app/setup";
  return NextResponse.redirect(url);
}

function ensureLocaleCookie(request: NextRequest, response: NextResponse) {
  if (request.cookies.get(LOCALE_COOKIE)?.value) return;
  const locale = detectLocaleFromAcceptLanguage(request.headers.get("accept-language"));
  response.cookies.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
  });
}

export async function proxy(request: NextRequest) {
  const githubAppRedirect = githubAppInstallCallbackRedirect(request);
  if (githubAppRedirect) return githubAppRedirect;

  if (request.nextUrl.pathname === "/admin") {
    const limited = await enforceRateLimit(request, {
      limit: 20,
      windowMs: 5 * 60_000,
      keyPrefix: "admin-page",
      errorMessage: "Too many attempts. Try again later.",
    });
    if (limited) return limited;
  }

  const response = await updateSession(request);
  ensureLocaleCookie(request, response);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
