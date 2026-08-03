import type { DetectionMethod, EvidenceItem } from "./schema";

export function computeConfidenceScore(input: {
  detectionMethod: DetectionMethod;
  evidenceItems: EvidenceItem[];
  severity: string;
  hasRuntimeEvidence: boolean;
  hasReplayEvidence: boolean;
  signalHits?: number;
}): { confidence: number; explanation: string } {
  const baseByMethod: Record<DetectionMethod, number> = {
    STATIC_ANALYSIS: 0.62,
    DYNAMIC_ANALYSIS: 0.78,
    REPLAY: 0.9,
    MOCK_SIMULATION: 0.68,
    AUTHORIZED_STAGING: 0.88,
    LIVE_VERIFICATION: 0.94,
    HYBRID: 0.82,
  };

  let score = baseByMethod[input.detectionMethod];
  const reasons: string[] = [`Base confidence for ${input.detectionMethod.replaceAll("_", " ").toLowerCase()}.`];

  const weightedEvidence = input.evidenceItems.reduce((sum, item) => {
    return sum + (item.confidence ?? 0.5);
  }, 0);
  if (input.evidenceItems.length > 0) {
    const evidenceBoost = Math.min(0.2, weightedEvidence / input.evidenceItems.length / 5);
    score += evidenceBoost;
    reasons.push(`${input.evidenceItems.length} evidence item(s) support the finding.`);
  }

  if (input.hasRuntimeEvidence) {
    score += 0.08;
    reasons.push("Runtime request/response evidence was captured.");
  }
  if (input.hasReplayEvidence) {
    score += 0.1;
    reasons.push("Replay reproduced the behavior.");
  }
  if ((input.signalHits ?? 0) >= 2) {
    score += 0.05;
    reasons.push("Multiple independent exploit signals matched.");
  }
  if (input.severity === "critical") {
    score += 0.03;
    reasons.push("Critical severity pattern increases confidence.");
  }

  score = Math.min(0.99, Math.max(0.05, Number(score.toFixed(3))));
  return {
    confidence: score,
    explanation: reasons.join(" "),
  };
}

export function confidencePercent(confidence: number): number {
  return Math.round(confidence * 100);
}
