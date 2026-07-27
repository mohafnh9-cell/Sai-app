import type { ConfidenceBand, FindingConfidence, NormalizedObservation } from "./models";
import type { DiscoveryReport } from "../discovery/types";

function bandFromScore(score: number): ConfidenceBand {
  if (score >= 0.85) return "very_high";
  if (score >= 0.7) return "high";
  if (score >= 0.5) return "medium";
  if (score >= 0.25) return "low";
  return "unknown";
}

export function scoreFindingConfidence(input: {
  observation: NormalizedObservation;
  discovery: DiscoveryReport;
  staticReviewConfidence?: number | null;
  replayVerified?: boolean;
  historicalVerified?: boolean;
}): FindingConfidence {
  const sources: string[] = [];
  let score = input.observation.confidence;

  if (input.observation.team === "browser") {
    sources.push("browser_evidence");
    if (input.observation.status === "confirmed") score += 0.15;
  }

  if (input.discovery.confidenceScore >= 0.6) {
    sources.push("discovery");
    score += 0.05;
  }

  if (input.staticReviewConfidence != null) {
    sources.push("static_review");
    score += Math.min(0.1, input.staticReviewConfidence * 0.1);
  }

  if (input.replayVerified) {
    sources.push("replay_verification");
    score += 0.2;
  }

  if (input.historicalVerified) {
    sources.push("historical_verification");
    score += 0.1;
  }

  score = Math.min(1, Math.max(0, score));

  return {
    findingId: input.observation.id,
    band: bandFromScore(score),
    score: Math.round(score * 100) / 100,
    sources,
  };
}

export function aggregateConfidence(confidences: FindingConfidence[]): ConfidenceBand {
  if (confidences.length === 0) return "unknown";
  const avg = confidences.reduce((sum, c) => sum + c.score, 0) / confidences.length;
  return bandFromScore(avg);
}
