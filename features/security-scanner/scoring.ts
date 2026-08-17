import { SEVERITY_WEIGHT } from "./constants";
import type { Finding, ScoreBreakdown, Severity } from "./types";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];
const CONFIDENCE_FACTOR = { high: 1, medium: 0.8, low: 0.5 } as const;
const MAX_OCCURRENCES_PER_RULE = 3;

/**
 * Converts cumulative raw penalty points into a 0–100 posture score.
 * Uses sqrt diminishing returns so medium/low volume cannot linearly collapse
 * the score, while severe cumulative risk still approaches 0.
 */
const SCORE_PENALTY_SCALE = 6;

function scoreFromRawPenalty(totalRawPenalty: number): number {
  if (totalRawPenalty <= 0) return 100;
  return Math.max(
    0,
    Math.min(100, Math.round(100 - SCORE_PENALTY_SCALE * Math.sqrt(totalRawPenalty)))
  );
}

export function scoreFindings(findings: Finding[]): ScoreBreakdown {
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<Severity, number>;
  const deductions = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<Severity, number>;
  const ruleSeverityDeductions = new Map<string, number>();
  for (const finding of findings) {
    counts[finding.severity] += 1;
    const weighted =
      SEVERITY_WEIGHT[finding.severity] * CONFIDENCE_FACTOR[finding.confidence];
    const bucket = `${finding.ruleId}:${finding.severity}`;
    const current = ruleSeverityDeductions.get(bucket) ?? 0;
    const cap = SEVERITY_WEIGHT[finding.severity] * MAX_OCCURRENCES_PER_RULE;
    const applied = Math.max(0, Math.min(weighted, cap - current));
    ruleSeverityDeductions.set(bucket, current + applied);
    deductions[finding.severity] += applied;
  }
  for (const severity of SEVERITIES) deductions[severity] = Math.round(deductions[severity]);
  const totalRawPenalty = Object.values(deductions).reduce((sum, value) => sum + value, 0);
  const score = scoreFromRawPenalty(totalRawPenalty);
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";
  return { score, grade, counts, deductions };
}
