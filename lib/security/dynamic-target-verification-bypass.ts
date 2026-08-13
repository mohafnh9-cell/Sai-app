import { isAuthBypassEnabled } from "@/lib/auth/dev-bypass";
import { isSubscriptionAdminEmail } from "@/lib/billing/admin-access";

/** When true, authenticated users can run dynamic checks on a URL without DNS/HTTP proof. */
export function isDynamicTargetVerificationBypassEnabled(
  email: string | null | undefined
): boolean {
  if (isAuthBypassEnabled()) return true;
  if (process.env.SEQURAI_SKIP_TARGET_VERIFICATION === "true") return true;
  return isSubscriptionAdminEmail(email);
}
