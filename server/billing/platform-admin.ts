import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isAuthBypassEnabled } from "@/lib/auth/dev-bypass";
import { isSubscriptionAdminEmail } from "@/lib/billing/admin-access";

export type PlatformAdminCheck = { id: string; email?: string | null };

/**
 * Canonical, single-source-of-truth check for "is this account a SequrAI
 * internal platform administrator" -- unlimited product access for
 * development, testing, and operating SequrAI.
 *
 * This is deliberately a THIRD axis, independent of:
 *   - organization role (OWNER/ADMIN/MEMBER): permission level within one
 *     customer organization. Any customer can be OWNER of their own org --
 *     that must never imply platform-admin access.
 *   - plan (FREE/PRO): the organization's billing tier, derived from Stripe.
 *     A platform admin's plan stays whatever it actually is (usually FREE,
 *     since no subscription is required) -- this function never reports or
 *     fakes a PRO plan.
 *
 * Resolution order (both signals are entirely server-derived; a client can
 * influence neither):
 *   1. profiles.is_platform_admin -- DB-backed, authoritative, toggleable by
 *      the service role without a redeploy. Protected at the database level
 *      (migration 065) so a user can never set this on their own row.
 *   2. SEQURAI_ADMIN_EMAILS -- the existing ops-controlled env allowlist,
 *      kept as a bootstrap/back-compat path so nothing already relying on it
 *      (the /admin dashboard gate) breaks.
 *   3. Auth-bypass dev mode.
 *
 * Callers must pass `admin` (the service-role Supabase client) and the
 * SERVER-AUTHENTICATED user's own id -- never a client-supplied id or email.
 */
export async function isPlatformAdmin(
  admin: SupabaseClient,
  user: PlatformAdminCheck
): Promise<boolean> {
  if (isAuthBypassEnabled()) return true;

  const { data: profile } = await admin
    .from("profiles")
    .select("is_platform_admin, email")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.is_platform_admin) return true;

  // Prefer the DB-verified email (fetched by the trusted server-derived
  // user id) over whatever the caller happened to pass in `user.email` --
  // this ties the allowlist check to the same verified identity as the DB
  // flag above, so a caller cannot grant admin by passing a mismatched
  // email alongside a correct id. `user.email` is only a fallback for the
  // rare case the profile lookup itself returns nothing.
  const email = profile?.email?.trim() || user.email?.trim() || null;
  return isSubscriptionAdminEmail(email);
}
