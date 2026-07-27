import type { AttackChain, BusinessImpactAssessment, NormalizedObservation } from "./models";
import { aggregateRiskScore } from "./business-impact";

export type RiskEngineSummary = {
  aggregateScore: number;
  highestSeverity: NormalizedObservation["severity"] | null;
  chainCount: number;
  criticalChainCount: number;
};

export function summarizeRisk(input: {
  observations: NormalizedObservation[];
  impacts: BusinessImpactAssessment[];
  chains: AttackChain[];
}): RiskEngineSummary {
  const aggregateScore = aggregateRiskScore(input.impacts);
  const severityRank = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
  let highest: NormalizedObservation["severity"] | null = null;
  for (const obs of input.observations) {
    if (!highest || severityRank[obs.severity] > severityRank[highest]) highest = obs.severity;
  }
  return {
    aggregateScore,
    highestSeverity: highest,
    chainCount: input.chains.length,
    criticalChainCount: input.chains.filter((c) => c.severity === "critical" || c.severity === "high").length,
  };
}
