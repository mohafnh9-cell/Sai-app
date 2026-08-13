import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isAuthBypassEnabled } from "@/lib/auth/dev-bypass";
import { organizationHasActiveSubscription } from "@/server/billing/subscription-status";

const SUBSCRIPTION_EXEMPT_PREFIXES = ["/billing", "/settings"];

const SUBSCRIPTION_REQUIRED_PREFIXES = [
  "/dashboard",
  "/projects",
  "/security",
  "/integrations",
  "/ai-fixes",
  "/timeline",
];

export function isSubscriptionExemptPath(pathname: string): boolean {
  return SUBSCRIPTION_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function isSubscriptionRequiredPath(pathname: string): boolean {
  if (pathname.startsWith("/onboarding")) return false;
  return SUBSCRIPTION_REQUIRED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function requiresSubscriptionRedirect(
  supabase: SupabaseClient,
  pathname: string,
  organizationId: string | null
): Promise<string | null> {
  if (isAuthBypassEnabled()) return null;
  if (!organizationId) return null;
  if (!isSubscriptionRequiredPath(pathname)) return null;
  if (isSubscriptionExemptPath(pathname)) return null;

  const active = await organizationHasActiveSubscription(supabase, organizationId);
  if (active) return null;

  return "/billing?reason=subscription_required";
}
