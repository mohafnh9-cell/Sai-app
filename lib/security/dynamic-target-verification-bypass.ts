import { isAuthBypassEnabled } from "@/lib/auth/dev-bypass";
import { isSubscriptionAdminEmail } from "@/lib/billing/admin-access";

function isProductionDeployment(): boolean {
  if (process.env.VERCEL_ENV === "production") return true;
  return process.env.NODE_ENV === "production" && process.env.VERCEL_ENV !== "preview";
}

/** When true, authenticated users can run dynamic checks on a URL without DNS/HTTP proof. */
export function isDynamicTargetVerificationBypassEnabled(
  email: string | null | undefined
): boolean {
  if (isAuthBypassEnabled()) return true;
  if (isSubscriptionAdminEmail(email)) return true;
  if (isProductionDeployment()) return false;
  return process.env.SEQURAI_SKIP_TARGET_VERIFICATION === "true";
}
