import "server-only";

import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentProductionVerdict } from "./core";
import { computeLiveProductionVerdict } from "./live-verdict";

export type VerdictConsistency = "consistent" | "diverged";

export type AuthoritativeProductionVerdict = {
  /** Persisted product verdict — authoritative for deploy decisions. */
  verdict: ProductionVerdictV1;
  /** Recomputed from scan findings for stale-data detection and diagnostics. */
  liveVerdict: ProductionVerdictV1 | null;
  consistency: VerdictConsistency;
  authoritative: "persisted";
};

function verdictsDiverge(
  persisted: ProductionVerdictV1,
  live: ProductionVerdictV1 | null
): boolean {
  if (!live) return false;
  return (
    persisted.status !== live.status ||
    persisted.score !== live.score ||
    persisted.blockersCount !== live.blockersCount ||
    persisted.scanId !== live.scanId
  );
}

/**
 * Persisted Production Verdict is the authoritative product verdict.
 * Live recomputation is returned only for explicit divergence metadata.
 */
export async function getAuthoritativeProductionVerdict(
  admin: SupabaseClient,
  projectId: string
): Promise<AuthoritativeProductionVerdict | null> {
  const persisted = await getCurrentProductionVerdict(admin, projectId);
  if (!persisted) return null;

  const liveVerdict = await computeLiveProductionVerdict(admin, {
    projectId,
    persisted,
    scan: persisted.scanId ? { id: persisted.scanId } : null,
  });

  return {
    verdict: persisted,
    liveVerdict,
    consistency: verdictsDiverge(persisted, liveVerdict) ? "diverged" : "consistent",
    authoritative: "persisted",
  };
}
