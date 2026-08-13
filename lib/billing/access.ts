import type { SubscriptionStatus } from "@/types/database";

export const ACTIVE_SUBSCRIPTION_STATUSES = new Set<SubscriptionStatus>(["active", "trialing"]);

export function isSubscriptionGracePeriodActive(): boolean {
  const until = process.env.SUBSCRIPTION_GRACE_UNTIL?.trim();
  if (!until) return false;
  const deadline = Date.parse(until);
  if (!Number.isFinite(deadline)) return false;
  return Date.now() < deadline;
}

export function hasActiveSubscriptionStatus(status: SubscriptionStatus | null | undefined): boolean {
  if (isSubscriptionGracePeriodActive()) return true;
  if (!status) return false;
  return ACTIVE_SUBSCRIPTION_STATUSES.has(status);
}

/** Site-wide route paywalls are disabled; scans are gated at API level. */
export function subscriptionRedirectPath(_pathname: string): string | null {
  return null;
}
