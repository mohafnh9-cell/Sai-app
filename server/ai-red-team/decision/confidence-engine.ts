import type { ConfidenceBand } from "../intelligence/models";
import type { SecurityIntelligenceReport } from "../intelligence/models";
import type { DecisionContext } from "./decision-context";
import type { CoverageAssessment } from "./coverage-engine";
import { aggregateConfidence } from "../intelligence/confidence-engine";

export function scoreDecisionConfidence(input: {
  intelligence: SecurityIntelligenceReport;
  context: DecisionContext;
  coverage: CoverageAssessment;
}): ConfidenceBand {
  const base = aggregateConfidence(input.intelligence.findingConfidences);
  const rank = { unknown: 0, low: 1, medium: 2, high: 3, very_high: 4 };
  let score = rank[base];

  if (input.context.replayStatus === "passed") score += 1;
  if (input.context.replayStatus === "failed") score -= 2;
  if (input.coverage.score >= 0.6) score += 1;
  if (input.coverage.score < 0.35) score -= 1;
  if (input.context.redTeamRunStatus === "running" || input.context.redTeamRunStatus === "queued") {
    score -= 2;
  }

  if (score >= 4) return "very_high";
  if (score >= 3) return "high";
  if (score >= 2) return "medium";
  if (score >= 1) return "low";
  return "unknown";
}
