import { mapVerdictStatusToDecision } from "@/server/mcp/decision-mapping";
import { narrativeMayApprove } from "./narrative-guard";
import type { ProductionVerdictV1 } from "./schema";

/**
 * The ONE place the web UI derives "may this verdict be shown as an
 * affirmative deployment decision" from.
 *
 * It composes the two canonical primitives already used by MCP, the GitHub
 * Check and the verdict hero -- `mapVerdictStatusToDecision` (status ->
 * decision) and `narrativeMayApprove` (high confidence AND every area
 * evaluated) -- and adds no policy of its own. UI layers must call this
 * instead of reinterpreting `status === "ready_to_ship"`.
 */
export type DeploymentEvidence = Pick<
  ProductionVerdictV1,
  "status" | "confidence" | "unevaluatedAreas" | "partiallyEvaluatedAreas"
>;

export const DEPLOYMENT_POSTURES = ["ready", "ready_evidence_limited", "more_analysis_required", "not_ready"] as const;

export type DeploymentPosture =
  /** ready_to_ship AND high confidence AND complete coverage: affirmative language allowed. */
  | "ready"
  /** ready_to_ship but evidence is limited: "no blockers found", never an approval. */
  | "ready_evidence_limited"
  /** insufficient_data / analysis_failed: the evidence cannot answer the question. */
  | "more_analysis_required"
  /** almost_ready / needs_improvement / not_ready: do not deploy. */
  | "not_ready";

export function deploymentPostureOf(verdict: DeploymentEvidence): DeploymentPosture {
  switch (mapVerdictStatusToDecision(verdict.status)) {
    case "deploy":
      // Coverage that cannot be read (missing arrays) is unknown, and unknown is not complete.
      if (!Array.isArray(verdict.unevaluatedAreas) || !Array.isArray(verdict.partiallyEvaluatedAreas)) {
        return "ready_evidence_limited";
      }
      return narrativeMayApprove(verdict) ? "ready" : "ready_evidence_limited";
    case "do_not_deploy":
      return "not_ready";
    case "more_analysis_required":
      return "more_analysis_required";
  }
}

/** True only when affirmative deployment language ("Sí", "Listo para desplegar", "Ready to ship") is permitted. */
export function verdictAffirmsDeploy(verdict: DeploymentEvidence | null | undefined): boolean {
  return verdict != null && deploymentPostureOf(verdict) === "ready";
}
