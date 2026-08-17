import type { OsvSeverityLevel } from "./types";

export function scoreToSeverityLevel(score: number): OsvSeverityLevel {
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  if (score > 0) return "low";
  return "unknown";
}

export function levelToScore(level: string): number {
  switch (level.toLowerCase()) {
    case "critical":
      return 9.5;
    case "high":
      return 7.5;
    case "medium":
    case "moderate":
      return 5;
    case "low":
      return 2.5;
    default:
      return 0;
  }
}

export function externalSeverityFromOsv(level: OsvSeverityLevel): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO" {
  switch (level) {
    case "critical":
      return "CRITICAL";
    case "high":
      return "HIGH";
    case "medium":
      return "MEDIUM";
    case "low":
      return "LOW";
    default:
      return "INFO";
  }
}

export function severityRankFromOsv(level: OsvSeverityLevel): number {
  switch (level) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}
