import { deploymentPostureOf, type DeploymentPosture } from "./deployment-posture";
import type { ProductionVerdictV1, VerdictStatus } from "./schema";

/**
 * What the Protection Status surface is allowed to say. It is NOT a second
 * decision system: it is a projection of the canonical Production Verdict.
 *
 *  - analysis_in_progress: a review is running. Non-decision.
 *  - no_verdict: there is no completed current verdict. Non-decision.
 *  - verdict: the posture is derived from the verdict by the same canonical
 *    gate every other surface uses (`deploymentPostureOf`).
 */
export type ProtectionDecision =
  | { state: "analysis_in_progress" }
  | { state: "no_verdict" }
  | {
      state: "verdict";
      posture: DeploymentPosture;
      verdictStatus: VerdictStatus;
      confidence: ProductionVerdictV1["confidence"];
      scanId: string;
      commitSha: string | null;
    };

export function protectionDecisionFor(input: {
  verdict: ProductionVerdictV1 | null;
  reviewInProgress: boolean;
}): ProtectionDecision {
  // A running review means the visible posture would describe an outdated
  // state: show an explicit non-decision instead of a stale answer.
  if (input.reviewInProgress) return { state: "analysis_in_progress" };
  if (!input.verdict) return { state: "no_verdict" };
  return {
    state: "verdict",
    posture: deploymentPostureOf(input.verdict),
    verdictStatus: input.verdict.status,
    confidence: input.verdict.confidence,
    scanId: input.verdict.scanId,
    commitSha: input.verdict.commitSha ?? null,
  };
}
