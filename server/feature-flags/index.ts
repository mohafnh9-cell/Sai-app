import "server-only";

export type FeatureRollout = "private_beta" | "internal" | "experimental" | "ga";

export type FeatureFlagKey =
  | "continuous_protection"
  | "security_alerts"
  | "protection_reports"
  | "safe_fix_v2"
  | "inngest_scheduler"
  | "mcp_enrichment"
  | "browser_team"
  | "api_team"
  | "authorization_team"
  | "business_logic_team"
  | "business_logic_persistence"
  | "llm_team"
  | "fix_strategy_engine"
  | "universal_engineering_engine"
  | "ai_adapters"
  | "verification_engine"
  | "autonomous_orchestrator"
  | "parallel_execution"
  | "adaptive_team_selection"
  | "mission_control"
  | "attack_simulation"
  | "analysis_run_isolation";

const DEFAULTS: Record<FeatureFlagKey, FeatureRollout> = {
  continuous_protection: "ga",
  security_alerts: "ga",
  protection_reports: "ga",
  safe_fix_v2: "ga",
  inngest_scheduler: "private_beta",
  mcp_enrichment: "ga",
  browser_team: "internal",
  api_team: "internal",
  authorization_team: "internal",
  business_logic_team: "internal",
  business_logic_persistence: "internal",
  llm_team: "internal",
  fix_strategy_engine: "internal",
  universal_engineering_engine: "internal",
  ai_adapters: "internal",
  verification_engine: "internal",
  autonomous_orchestrator: "internal",
  parallel_execution: "internal",
  adaptive_team_selection: "internal",
  mission_control: "ga",
  attack_simulation: "ga",
  analysis_run_isolation: "internal",
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
