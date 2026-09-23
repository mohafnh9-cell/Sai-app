import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";

/**
 * A verdict is only evidence about the scan it was generated from. The
 * project-level "current" verdict may belong to a different scan than the
 * one an audit just reviewed (an older scan whose successor's verdict is
 * still being generated, or a concurrent review), so it must never be paired
 * with another scan's findings as if it described them.
 */
export function bindVerdictToScan(
  verdict: ProductionVerdictV1 | null,
  scanId: string
): ProductionVerdictV1 | null {
  return verdict && verdict.scanId === scanId ? verdict : null;
}
