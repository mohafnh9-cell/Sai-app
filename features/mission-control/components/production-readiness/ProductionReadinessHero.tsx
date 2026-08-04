"use client";

import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { ProductionVerdictSurface } from "@/features/production-verdict/components/ProductionVerdictSurface";

/** @deprecated Use ProductionVerdictSurface variant="guided" */
export function ProductionReadinessHero({ verdict }: { verdict: ProductionVerdictV1 }) {
  return <ProductionVerdictSurface verdict={verdict} variant="guided" />;
}
