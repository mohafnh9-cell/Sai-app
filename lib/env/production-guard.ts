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

export function assertProductionSafe(): void {
  const deployedProduction = process.env.VERCEL_ENV === "production";
  const runtimeProduction =
    process.env.NODE_ENV === "production" && process.env.VERCEL_ENV !== "preview";
  const production = deployedProduction || runtimeProduction;

  if (production && isBypassFlagSet()) {
    throw new Error(
      "SEQURAI_BYPASS_AUTH cannot be enabled in production. Remove it from your deployment environment."
    );
  }

  if (production && isSkipTargetVerificationFlagSet()) {
    throw new Error(
      "SEQURAI_SKIP_TARGET_VERIFICATION cannot be enabled in production. Remove it from your deployment environment."
    );
  }
}

export function isAuthBypassAllowed(): boolean {
  if (process.env.NODE_ENV === "production") {
    assertProductionSafe();
    return false;
  }
  return isBypassFlagSet();
}
