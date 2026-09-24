import "server-only";

import type { ProductionReadyScore, BrainPriority } from "@/brain";
import { deployAnswerFromVerdictEvidence } from "@/server/production-memory/types";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";

/** Derive legacy ProductionReadyScore shape from canonical verdict — do not recalculate. */
export function productionReadyFromVerdict(verdict: ProductionVerdictV1): ProductionReadyScore {
  return {
    overall: verdict.score,
    dimensions: {
      security: verdict.evaluatedAreas.find((a) => a.key === "security")?.score ?? null,
      authentication:
        verdict.partiallyEvaluatedAreas.find((a) => a.key === "authentication")?.score ??
        verdict.evaluatedAreas.find((a) => a.key === "authentication")?.score ??
        null,
      databaseDesign:
        verdict.partiallyEvaluatedAreas.find((a) => a.key === "database")?.score ?? null,
      bestPractices: null,
      architecture:
        verdict.partiallyEvaluatedAreas.find((a) => a.key === "architecture")?.score ?? null,
      performance: null,
      deploymentReadiness:
        verdict.partiallyEvaluatedAreas.find((a) => a.key === "deployment")?.score ?? null,
    },
    blockersCount: verdict.blockersCount,
    improvementsCount: Math.max(0, verdict.findingsCount - verdict.blockersCount),
    estimatedMinutesToReady: verdict.estimatedFixMinutes,
    // Status alone is not a readiness claim: it must also clear the canonical
    // decision-language policy (confidence / area coverage).
    readyForProduction: deployAnswerFromVerdictEvidence(verdict) === "go",
  };
}

export function prioritiesFromVerdict(verdict: ProductionVerdictV1): BrainPriority[] {
  return verdict.topPriorities.map((priority) => ({
    rank: priority.rank,
    title: priority.title,
    description: priority.reason,
    estimatedMinutes: priority.estimatedMinutes,
    source: "scan" as const,
  }));
}

export const EMPTY_PRODUCTION_READY: ProductionReadyScore = {
  overall: null,
  dimensions: {
    security: null,
    architecture: null,
    bestPractices: null,
    performance: null,
    authentication: null,
    databaseDesign: null,
    deploymentReadiness: null,
  },
  blockersCount: 0,
  improvementsCount: 0,
  estimatedMinutesToReady: 0,
  readyForProduction: false,
};
