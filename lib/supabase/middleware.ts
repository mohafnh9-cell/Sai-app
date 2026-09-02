import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthBypassEnabled } from "@/lib/auth/dev-bypass";
import { safeNextPath } from "@/lib/auth/safe-next-path";
import {
  internalOpsUnauthorizedResponse,
  verifyInternalOpsRequest,
} from "@/lib/auth/internal-ops";

const PROTECTED_PATHS = [
  "/dashboard",
  "/projects",
  "/security",
  "/ai-fixes",
  "/timeline",
  "/integrations",
  "/billing",
  "/settings",
  "/onboarding",
  // L2 (audit): the /admin page already redirects unauthenticated/non-admin
  // users itself, so this wasn't independently exploitable -- but it's the
  // one route that most needs a middleware backstop if a future edit ever
  // drops that page-level check.
  "/admin",
];

const AUTH_PATHS = ["/login", "/signup"];

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/api/inngest")) {
    return NextResponse.next({ request });
  }
  if (pathname.startsWith("/api/internal")) {
    if (!verifyInternalOpsRequest(request)) {
      return internalOpsUnauthorizedResponse();
    }
    return NextResponse.next({ request });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || supabaseUrl === "your_supabase_project_url" || !supabaseKey) {
    const isProtected = PROTECTED_PATHS.some((p) => pathname.startsWith(p));
    if (process.env.NODE_ENV === "production" && isProtected && !isAuthBypassEnabled()) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (pathname.startsWith("/demo")) {
    supabaseResponse.headers.set("X-Robots-Tag", "noindex, nofollow");
  }

  const isProtected = PROTECTED_PATHS.some((p) => pathname.startsWith(p));
  const isAuthPath = AUTH_PATHS.some((p) => pathname.startsWith(p));

  if (!user && isProtected && !isAuthBypassEnabled()) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(url);
  }

  if (user && isAuthPath) {
    const url = request.nextUrl.clone();
    url.pathname = safeNextPath(request.nextUrl.searchParams.get("redirectTo"));
    url.searchParams.delete("redirectTo");
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
