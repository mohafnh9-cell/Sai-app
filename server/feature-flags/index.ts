import "server-only";

export type FeatureRollout = "private_beta" | "internal" | "experimental" | "ga";

export type FeatureFlagKey =
  | "continuous_protection"
  | "security_alerts"
  | "protection_reports"
  | "safe_fix_v2"
  | "inngest_scheduler"
  | "mcp_enrichment";

const DEFAULTS: Record<FeatureFlagKey, FeatureRollout> = {
  continuous_protection: "ga",
  security_alerts: "ga",
  protection_reports: "ga",
  safe_fix_v2: "ga",
  inngest_scheduler: "private_beta",
  mcp_enrichment: "ga",
};

function parseOverrides(): Partial<Record<FeatureFlagKey, FeatureRollout>> {
  const raw = process.env.SEQURAI_FEATURE_FLAGS_JSON?.trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Partial<Record<FeatureFlagKey, FeatureRollout>>;
  } catch {
    return {};
  }
}

const OVERRIDES = parseOverrides();

export function getFeatureRollout(flag: FeatureFlagKey): FeatureRollout {
  return OVERRIDES[flag] ?? DEFAULTS[flag];
}

export function isFeatureEnabled(
  flag: FeatureFlagKey,
  context?: { organizationId?: string; allowlist?: string[] }
): boolean {
  const rollout = getFeatureRollout(flag);
  if (rollout === "ga") return true;
  if (rollout === "internal") {
    return process.env.SEQURAI_INTERNAL_ORG_IDS?.split(",").includes(context?.organizationId ?? "") ?? false;
  }
  if (rollout === "private_beta") {
    const list =
      context?.allowlist ??
      process.env.SEQURAI_BETA_ORG_IDS?.split(",").map((s) => s.trim()).filter(Boolean) ??
      [];
    if (!context?.organizationId) return false;
    return list.includes(context.organizationId);
  }
  return false;
}

export function listFeatureFlags(context?: { organizationId?: string }) {
  return (Object.keys(DEFAULTS) as FeatureFlagKey[]).map((key) => ({
    key,
    rollout: getFeatureRollout(key),
    enabled: isFeatureEnabled(key, context),
  }));
}
