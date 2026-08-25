import type { NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "@/lib/i18n/config";
import { detectLocaleFromAcceptLanguage } from "@/lib/i18n/detect";
import { enforceRateLimit } from "@/server/http/rate-limit";

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
  if (request.nextUrl.pathname === "/admin") {
    const limited = enforceRateLimit(request, {
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
