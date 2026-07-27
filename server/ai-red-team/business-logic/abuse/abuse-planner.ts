import type { BusinessInvariant } from "../invariants/invariant.types";
import type { AbuseStrategy } from "./abuse.types";

/** Plans which invariant categories are eligible for abuse generation. */
export function planAbuseForInvariants(invariants: BusinessInvariant[]): BusinessInvariant[] {
  return invariants.filter((i) => i.confidence !== "unsupported");
}

export function mergeStrategies(
  core: AbuseStrategy[],
  extensions: AbuseStrategy[] = []
): AbuseStrategy[] {
  const byId = new Map<string, AbuseStrategy>();
  for (const strategy of [...core, ...extensions]) {
    if (!byId.has(strategy.id)) byId.set(strategy.id, strategy);
  }
  return [...byId.values()];
}

export const BusinessAbusePlanner = {
  plan: planAbuseForInvariants,
  mergeStrategies,
};
