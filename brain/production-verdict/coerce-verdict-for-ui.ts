import type { ProductionVerdictV1 } from "./schema";

/** Ensure verdict arrays exist before Mission Control UI reads them. */
export function coerceVerdictForUi(
  verdict: ProductionVerdictV1 | null
): ProductionVerdictV1 | null {
  if (!verdict) return null;
  return {
    ...verdict,
    topPriorities: verdict.topPriorities ?? [],
    evaluatedAreas: verdict.evaluatedAreas ?? [],
    partiallyEvaluatedAreas: verdict.partiallyEvaluatedAreas ?? [],
    unevaluatedAreas: verdict.unevaluatedAreas ?? [],
  };
}
