import type { CoreProtectedAsset } from "../../core/assets/asset.types";
import type { CoreTrustBoundary } from "../../core/boundaries/boundary.types";
import type { CoreAttackPreconditions } from "../../core/preconditions/precondition.types";
import type { ThreatSourceReference } from "../threat-model.types";

/** Map RT-Core protected assets to threat-model source refs (no duplicate asset model). */
export function coreAssetsToSourceRefs(assets: CoreProtectedAsset[], team: "rt9" | "rt10"): ThreatSourceReference[] {
  return assets
    .map((a) => ({
      kind: team === "rt9" ? ("rt9_asset" as const) : ("rt10_asset" as const),
      refId: a.id,
      label: a.label,
    }))
    .sort((a, b) => a.refId.localeCompare(b.refId));
}

export function coreBoundariesToRefs(boundaries: CoreTrustBoundary[]): ThreatSourceReference[] {
  return boundaries
    .map((b) => ({
      kind: "rt10_boundary" as const,
      refId: b.id,
      label: b.label,
    }))
    .sort((a, b) => a.refId.localeCompare(b.refId));
}

export function preconditionBlockingLabels(pre: CoreAttackPreconditions): string[] {
  return [...pre.blockingConditions, ...pre.unsupportedConditions].sort((a, b) => a.localeCompare(b));
}
