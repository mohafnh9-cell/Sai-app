import { formatConfidenceDistribution, summarizeConfidenceDistribution } from "@/brain/confidence/derive";
import type { ConfidenceDistribution } from "@/brain/confidence/types";
import { VERDICT_STATUS_LABELS, type ProductionVerdictV1, type VerdictStatus } from "./schema";
import { verdictHeadline } from "./status-rules";

export function buildDeterministicSummary(
  verdict: Pick<
  ProductionVerdictV1,
  | "status"
  | "score"
  | "blockersCount"
  | "criticalBlockersCount"
  | "highBlockersCount"
  | "topPriorities"
  | "evaluatedAreas"
  | "unevaluatedAreas"
>,
  blockerConfidence?: ConfidenceDistribution
): string {
  const label = VERDICT_STATUS_LABELS[verdict.status];
  const scorePart =
    verdict.score != null ? `Production Ready Score is ${verdict.score}/100.` : "Score unavailable due to limited coverage.";

  if (verdict.status === "insufficient_data") {
    return `${label}. SequrAI did not analyze enough of the repository to issue a confident production decision. Run a full analysis first.`;
  }

  if (verdict.status === "analysis_failed") {
    return `${label}. The scan did not complete successfully. Review the error and re-run the analysis.`;
  }

  if (verdict.status === "ready_to_ship") {
    return `${label}. ${scorePart} No production blockers detected. Your application meets the current readiness threshold.`;
  }

  const blockerPart =
    verdict.blockersCount > 0
      ? `${verdict.blockersCount} production blocker${verdict.blockersCount === 1 ? "" : "s"} (${verdict.criticalBlockersCount} critical, ${verdict.highBlockersCount} high) prevent safe deployment.${
          blockerConfidence && formatConfidenceDistribution(blockerConfidence)
            ? ` Evidence strength: ${formatConfidenceDistribution(blockerConfidence)}.`
            : ""
        }`
      : "No critical blockers, but improvements remain before shipping.";

  const priorityPart =
    verdict.topPriorities.length > 0
      ? ` Start with: ${verdict.topPriorities[0].title}.`
      : "";

  const coveragePart =
    verdict.unevaluatedAreas.length > 0
      ? ` Note: ${verdict.unevaluatedAreas.length} areas are not yet evaluated (including performance and testing).`
      : "";

  return `${label}. ${scorePart} ${blockerPart}${priorityPart}${coveragePart}`;
}

export function buildMethodologyNote(verdict: Pick<
  ProductionVerdictV1,
  "evaluatedAreas" | "partiallyEvaluatedAreas" | "unevaluatedAreas"
>): string {
  const evaluated = verdict.evaluatedAreas.map((a) => a.label).join(", ");
  const partial = verdict.partiallyEvaluatedAreas.map((a) => a.label).join(", ");
  const skipped = verdict.unevaluatedAreas.map((a) => a.label).join(", ");

  const parts = [
    evaluated ? `Evaluated: ${evaluated}.` : "",
    partial ? `Partially evaluated: ${partial}.` : "",
    skipped ? `Not evaluated: ${skipped}.` : "",
  ].filter(Boolean);

  return `Score v1 is primarily driven by static security analysis. ${parts.join(" ")}`.trim();
}

export { verdictHeadline };
