import { vi } from "vitest";
import type { FeatureFlagKey, FeatureRollout } from "@/server/feature-flags";

/**
 * server/feature-flags reads SEQURAI_FEATURE_FLAGS_JSON once at module load
 * time (`const OVERRIDES = parseOverrides()`), so changing the env var after
 * the module — or anything importing it — has already loaded has no effect.
 * Several ai-red-team/business-logic/llm-team tests were written when
 * business_logic_team and llm_team were "internal"-gated; both are "ga"
 * (enabled for every org) by default now, a real product promotion, not a
 * bug. To exercise the disabled-for-non-internal-orgs path they test, force
 * a fresh module evaluation with the override in place via this helper.
 */
export async function withFeatureFlagOverrides<T>(
  overrides: Partial<Record<FeatureFlagKey, FeatureRollout>>,
  run: () => Promise<T>
): Promise<T> {
  const prev = process.env.SEQURAI_FEATURE_FLAGS_JSON;
  process.env.SEQURAI_FEATURE_FLAGS_JSON = JSON.stringify(overrides);
  vi.resetModules();
  try {
    return await run();
  } finally {
    if (prev === undefined) delete process.env.SEQURAI_FEATURE_FLAGS_JSON;
    else process.env.SEQURAI_FEATURE_FLAGS_JSON = prev;
    vi.resetModules();
  }
}
