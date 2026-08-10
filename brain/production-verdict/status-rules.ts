import { VERDICT_THRESHOLDS } from "./config";
import type { NormalizedFinding } from "./normalize-finding";
import { isCriticalSignal as checkCriticalSignal } from "./normalize-finding";
import { isNonBlockingSecretClassification } from "@/features/security-scanner/rules/secret-classification";
import type { VerdictStatus } from "./schema";

export type StatusRuleInput = {
  scanStatus: string;
  score: number | null;
  criticalBlockersCount: number;
  highBlockersCount: number;
  hasSufficientCoverage: boolean;
  findings: NormalizedFinding[];
  partialScanFailure?: boolean;
};

export function determineVerdictStatus(input: StatusRuleInput): VerdictStatus {
  if (input.scanStatus === "failed") {
    return "analysis_failed";
  }

  if (input.partialScanFailure) {
    return "insufficient_data";
  }

  if (!input.hasSufficientCoverage) {
    return "insufficient_data";
  }

  if (input.score === null && input.criticalBlockersCount === 0 && input.highBlockersCount === 0) {
    return "insufficient_data";
  }

  const criticalSignals = input.findings.filter(checkCriticalSignal);
  const exposedSecret = input.findings.some((f) => {
    if (isNonBlockingSecretClassification(f.secretClassification)) return false;
    const hay = `${f.title} ${f.category} ${f.ruleId ?? ""}`.toLowerCase();
    return (
      f.severity === "critical" &&
      f.confidence === "high" &&
      (hay.includes("secret") || hay.includes("credential") || hay.includes("api key"))
    );
  });

  if (
    input.criticalBlockersCount > 0 ||
    criticalSignals.length > 0 ||
    exposedSecret
  ) {
    return "not_ready";
  }

  const score = input.score ?? 0;

  if (
    score >= VERDICT_THRESHOLDS.readyToShipScore &&
    input.highBlockersCount <= VERDICT_THRESHOLDS.maxHighBlockersForReady
  ) {
    return "ready_to_ship";
  }

  if (
    score >= VERDICT_THRESHOLDS.almostReadyScore &&
    input.highBlockersCount <= VERDICT_THRESHOLDS.maxHighBlockersForAlmostReady
  ) {
    return "almost_ready";
  }

  if (score >= VERDICT_THRESHOLDS.needsImprovementScore) {
    return "needs_improvement";
  }

  return "not_ready";
}

export function verdictHeadline(status: VerdictStatus): string {
  switch (status) {
    case "ready_to_ship":
      return "READY TO SHIP";
    case "almost_ready":
      return "ALMOST READY";
    case "needs_improvement":
      return "NEEDS IMPROVEMENT";
    case "not_ready":
      return "NOT READY TO SHIP";
    case "insufficient_data":
      return "MORE ANALYSIS REQUIRED";
    case "analysis_failed":
      return "ANALYSIS FAILED";
  }
}

export function recommendedAction(status: VerdictStatus, blockersCount: number): string {
  switch (status) {
    case "ready_to_ship":
      return "Deploy when your release process is ready. SequrAI will review every subsequent push.";
    case "almost_ready":
      return "Resolve the remaining blockers on your fastest path forward, then re-run the analysis.";
    case "needs_improvement":
      return blockersCount > 0
        ? "Start with priority 1 on the fastest path forward before shipping to production."
        : "Address the top improvements to increase your Production Ready Score.";
    case "not_ready":
      return "Do not ship until production blockers are resolved. Start with priority 1.";
    case "insufficient_data":
      return "Run a full production analysis with sufficient repository coverage before shipping.";
    case "analysis_failed":
      return "Review the scan error and re-run the analysis when the issue is resolved.";
  }
}

export function overallConfidence(input: {
  status: VerdictStatus;
  filesAnalyzed: number;
  findingsCount: number;
}): "high" | "medium" | "low" {
  if (input.status === "insufficient_data" || input.status === "analysis_failed") {
    return "low";
  }
  if (input.filesAnalyzed >= 20 && input.findingsCount >= 0) return "high";
  if (input.filesAnalyzed >= 5) return "medium";
  return "low";
}
