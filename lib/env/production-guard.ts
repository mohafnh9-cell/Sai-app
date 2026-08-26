import "server-only";

const TRUTHY_VALUES = new Set(["true", "1", "yes"]);

function isTruthyEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return Boolean(normalized && TRUTHY_VALUES.has(normalized));
}

export function isBypassFlagSet(): boolean {
  return isTruthyEnv(process.env.SEQURAI_BYPASS_AUTH);
}

export function isSkipTargetVerificationFlagSet(): boolean {
  return isTruthyEnv(process.env.SEQURAI_SKIP_TARGET_VERIFICATION);
}

/**
 * True for any Vercel-hosted deployment — production AND preview. NODE_ENV
 * alone isn't a reliable enough gate for something as dangerous as an auth
 * bypass: `next build` sets NODE_ENV=production for preview deploys too, but
 * relying on that single check means one build-config quirk away from a
 * total auth bypass in a real, publicly reachable deployment. VERCEL /
 * VERCEL_ENV are set unconditionally by Vercel's own runtime, independent of
 * how the app itself computes NODE_ENV.
 */
export function isRunningOnVercel(): boolean {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
}

export function assertProductionSafe(): void {
  const deployedProduction = process.env.VERCEL_ENV === "production";
  const runtimeProduction =
    process.env.NODE_ENV === "production" && process.env.VERCEL_ENV !== "preview";
  const production = deployedProduction || runtimeProduction || isRunningOnVercel();

  if (production && isBypassFlagSet()) {
    throw new Error(
      "SEQURAI_BYPASS_AUTH cannot be enabled on a Vercel deployment. Remove it from your deployment environment."
    );
  }

  if (production && isSkipTargetVerificationFlagSet()) {
    throw new Error(
      "SEQURAI_SKIP_TARGET_VERIFICATION cannot be enabled on a Vercel deployment. Remove it from your deployment environment."
    );
  }
}

export function isAuthBypassAllowed(): boolean {
  if (isRunningOnVercel() || process.env.NODE_ENV === "production") {
    assertProductionSafe();
    return false;
  }
  return isBypassFlagSet();
}
