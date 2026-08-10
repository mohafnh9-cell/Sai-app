import "server-only";

import type { AttackHypothesis } from "@/server/attack-simulation/contracts/attack-hypothesis";
import type { DynamicTargetFixtures } from "@/server/attack-simulation/dynamic/authorized-target";
import { ATTACK_ADAPTER_CATALOG } from "@/server/attack-simulation/planner/adapter-catalog";

export function normalizeRequiredDynamicPath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "*" || trimmed === "/*") return null;
  const normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (normalized.includes("..")) return null;
  return normalized;
}

function hypothesisHasSafeRouteMapping(hypothesis: AttackHypothesis): boolean {
  const metadata = hypothesis.metadata;
  if (!metadata || metadata.routeMappable !== true) return false;
  if (typeof metadata.staticFindingId !== "string" || !metadata.staticFindingId) return false;
  if (typeof metadata.adapterHint !== "string" || !metadata.adapterHint) return false;
  if (!ATTACK_ADAPTER_CATALOG.some((entry) => entry.id === metadata.adapterHint)) return false;
  const fixtures = metadata.fixtures as DynamicTargetFixtures | undefined;
  if (!fixtures?.paths || Object.keys(fixtures.paths).length === 0) return false;
  return true;
}

/** Paths inferred with high confidence from static findings → conservative route mapper → existing adapter. */
export function collectRequiredDynamicPaths(hypotheses: AttackHypothesis[]): string[] {
  const paths = new Set<string>();

  for (const hypothesis of hypotheses) {
    if (!hypothesisHasSafeRouteMapping(hypothesis)) continue;
    const fixtures = hypothesis.metadata!.fixtures as DynamicTargetFixtures;
    for (const path of Object.values(fixtures.paths ?? {})) {
      if (typeof path !== "string") continue;
      const normalized = normalizeRequiredDynamicPath(path);
      if (normalized) paths.add(normalized);
    }
  }

  return [...paths].sort();
}

export function collectUnsafeRouteHypothesisIds(hypotheses: AttackHypothesis[]): string[] {
  return hypotheses
    .filter((hypothesis) => hypothesis.metadata?.notSafelyTestableReason)
    .map((hypothesis) => hypothesis.id);
}
