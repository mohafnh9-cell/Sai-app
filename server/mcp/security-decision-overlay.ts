import { guardDecisionText, type DecisionLanguagePolicy } from "./decision-language-policy";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import {
  mapSecurityDeploymentToMcpRecommendation,
  securityDeploymentVerdictLabel,
} from "@/server/ai-red-team/decision/production-verdict-bridge";

export type SecurityDecisionMcpOverlay = {
  applied: boolean;
  deploymentVerdict: string | null;
  deploymentRecommendation: "SHIP_IT" | "DO_NOT_DEPLOY" | "MORE_ANALYSIS_REQUIRED" | null;
  executiveSummarySuffix: string | null;
  verdict: ProductionVerdictV1;
};

/**
 * MCP deploy answers use the persisted Production Verdict only — no in-memory recomputation.
 *
 * SECURITY INVARIANT: a verdict computed from insufficient evaluated
 * coverage ("insufficient_data") or a failed analysis ("analysis_failed")
 * must never have its deployment recommendation promoted by this overlay,
 * regardless of what the security decision report itself concluded. The
 * AI red-team decision subsystem answers "did we find an attack chain?" —
 * that is not the same claim as "did we evaluate enough of the
 * application to trust this answer?" A project with zero findings and a
 * high score but only partial coverage is not equivalent to production
 * readiness, and no downstream opinion is allowed to contradict that.
 * Insufficient coverage always wins; it is intentionally never
 * overridable from this call site.
 */
export function applyLatestSecurityDecisionToVerdict(
  _projectId: string,
  verdict: ProductionVerdictV1,
  policy: DecisionLanguagePolicy
): SecurityDecisionMcpOverlay {
  const insufficientCoverage =
    verdict.status === "insufficient_data" || verdict.status === "analysis_failed";

  if (verdict.securityDecisionId && verdict.securityDeploymentVerdict && !insufficientCoverage) {
    const overlayStatus =
      verdict.securityDeploymentVerdict as import("@/server/ai-red-team/decision/decision-model").SecurityDeploymentVerdictStatus;
    const overlayRecommendation = mapSecurityDeploymentToMcpRecommendation(overlayStatus);
    // DETERMINISTIC POLICY WINS: the overlay may only weaken the policy's
    // recommendation, never promote it, and its wording is dropped whenever
    // it would state more than the policy allows.
    const policyRecommendation =
      policy.decision === "deploy"
        ? "SHIP_IT"
        : policy.decision === "do_not_deploy"
          ? "DO_NOT_DEPLOY"
          : "MORE_ANALYSIS_REQUIRED";
    const deploymentRecommendation =
      overlayRecommendation === "SHIP_IT" && policyRecommendation !== "SHIP_IT"
        ? policyRecommendation
        : overlayRecommendation;
    const suffix = `Security Decision: ${securityDeploymentVerdictLabel(overlayStatus)}.`;
    return {
      applied: true,
      deploymentVerdict: verdict.securityDeploymentVerdict,
      deploymentRecommendation,
      executiveSummarySuffix: guardDecisionText(suffix, policy, "") || null,
      verdict,
    };
  }

  return {
    applied: false,
    deploymentVerdict: null,
    deploymentRecommendation: null,
    executiveSummarySuffix: null,
    verdict,
  };
}
