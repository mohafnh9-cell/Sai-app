import { buildProductionJourney, type VerdictJourneyRecord } from "@/brain/production-journey/build";
import { PRODUCTION_VERDICT_VERSION, type ProductionVerdictV1 } from "@/brain/production-verdict/schema";

export type Kind = "ready_full" | "ready_low_incomplete" | "ready_medium_incomplete" | "not_ready" | "insufficient";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const area = (key: string) => ({ key, label: key, score: null, status: "not_evaluated", confidence: "low", limitations: "", methodology: "", evidenceCount: 0 });

export function verdict(kind: Kind, index: number): ProductionVerdictV1 {
  const base = {
    version: PRODUCTION_VERDICT_VERSION, projectId: uuid(1), repositoryId: uuid(1), scanId: uuid(100 + index), commitSha: "abc123", branch: "main",
    previousScore: null, scoreDelta: null, projectedScore: 100, projectedScoreIsEstimate: true, estimatedFixMinutes: 0,
    executiveSummary: "s", topPriorities: [], evaluatedAreas: [], partiallyEvaluatedAreas: [], unevaluatedAreas: [],
    introducedBlockers: 0, resolvedBlockers: 0, coverageRatio: 1, filesAnalyzed: 13, findingsCount: 0,
    recommendedAction: "r", methodologyNote: "m", generatedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
  };
  switch (kind) {
    case "ready_full":
      return { ...base, status: "ready_to_ship", score: 100, confidence: "high", blockersCount: 0, criticalBlockersCount: 0, highBlockersCount: 0 } as ProductionVerdictV1;
    case "ready_low_incomplete":
      return { ...base, status: "ready_to_ship", score: 100, confidence: "low", blockersCount: 0, criticalBlockersCount: 0, highBlockersCount: 0, unevaluatedAreas: [area("testing")] } as ProductionVerdictV1;
    case "ready_medium_incomplete":
      return { ...base, status: "ready_to_ship", score: 100, confidence: "medium", blockersCount: 0, criticalBlockersCount: 0, highBlockersCount: 0, unevaluatedAreas: [area("testing")] } as ProductionVerdictV1;
    case "not_ready":
      return { ...base, status: "not_ready", score: 0, confidence: "low", blockersCount: 10, criticalBlockersCount: 1, highBlockersCount: 9 } as ProductionVerdictV1;
    case "insufficient":
      return { ...base, status: "insufficient_data", score: null, confidence: "low", blockersCount: 0, criticalBlockersCount: 0, highBlockersCount: 0 } as ProductionVerdictV1;
  }
}

export function record(kind: Kind, index: number): VerdictJourneyRecord {
  const v = verdict(kind, index);
  return {
    id: uuid(1000 + index), scanId: v.scanId, projectId: v.projectId, repositoryId: v.repositoryId, generatedAt: v.generatedAt, commitSha: v.commitSha, branch: v.branch,
    status: v.status, score: v.score, previousScore: v.previousScore, scoreDelta: v.scoreDelta, blockersCount: v.blockersCount,
    introducedBlockers: 0, resolvedBlockers: 0, verdict: v,
  };
}

export const journeyOf = (kinds: Kind[]) => buildProductionJourney(kinds.map((k, i) => record(k, i)));

