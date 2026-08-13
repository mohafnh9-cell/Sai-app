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

export function subscriptionRedirectPath(pathname: string): string | null {
  if (!isSubscriptionRequiredPath(pathname) || isSubscriptionExemptPath(pathname)) {
    return null;
  }
  return "/billing?reason=subscription_required";
}
