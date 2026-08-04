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
 */
export function applyLatestSecurityDecisionToVerdict(
  _projectId: string,
  verdict: ProductionVerdictV1
): SecurityDecisionMcpOverlay {
  if (verdict.securityDecisionId && verdict.securityDeploymentVerdict) {
    return {
      applied: true,
      deploymentVerdict: verdict.securityDeploymentVerdict,
      deploymentRecommendation: mapSecurityDeploymentToMcpRecommendation(
        verdict.securityDeploymentVerdict as import("@/server/ai-red-team/decision/decision-model").SecurityDeploymentVerdictStatus
      ),
      executiveSummarySuffix: `Security Decision: ${securityDeploymentVerdictLabel(
        verdict.securityDeploymentVerdict as import("@/server/ai-red-team/decision/decision-model").SecurityDeploymentVerdictStatus
      )}.`,
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
