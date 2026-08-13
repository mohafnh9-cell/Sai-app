import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthBypassEnabled } from "@/lib/auth/dev-bypass";
import { safeNextPath } from "@/lib/auth/safe-next-path";
import {
  internalOpsUnauthorizedResponse,
  verifyInternalOpsRequest,
} from "@/lib/auth/internal-ops";
import {
  hasActiveSubscriptionStatus,
  subscriptionRedirectPath,
} from "@/lib/billing/access";
import { ACTIVE_WORKSPACE_COOKIE } from "@/lib/workspaces/constants";
import { isAuthBypassAllowed } from "@/lib/env/production-guard";

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
];

const AUTH_PATHS = ["/login", "/signup"];

async function resolveActiveOrganizationId(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
  cookieOrganizationId?: string | null
): Promise<string | null> {
  if (cookieOrganizationId) {
    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", userId)
      .eq("organization_id", cookieOrganizationId)
      .maybeSingle();
    if (membership?.organization_id) return membership.organization_id;
  }

  const { data: fallbackMembership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return fallbackMembership?.organization_id ?? null;
}

async function subscriptionGateRedirect(
  request: NextRequest,
  supabase: ReturnType<typeof createServerClient>,
  userId: string
): Promise<NextResponse | null> {
  if (isAuthBypassAllowed()) return null;

  const redirectPath = subscriptionRedirectPath(request.nextUrl.pathname);
  if (!redirectPath) return null;

  const organizationId = await resolveActiveOrganizationId(
    supabase,
    userId,
    request.cookies.get(ACTIVE_WORKSPACE_COOKIE)?.value
  );
  if (!organizationId) return null;

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("status")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (hasActiveSubscriptionStatus(subscription?.status as Parameters<typeof hasActiveSubscriptionStatus>[0])) {
    return null;
  }

  const url = request.nextUrl.clone();
  url.pathname = "/billing";
  url.searchParams.set("reason", "subscription_required");
  return NextResponse.redirect(url);
}

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

  if (user) {
    const subscriptionRedirect = await subscriptionGateRedirect(request, supabase, user.id);
    if (subscriptionRedirect) return subscriptionRedirect;
  }

  return supabaseResponse;
}
