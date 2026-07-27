import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import {
  applySecurityDecisionToProductionVerdict,
  mapSecurityDeploymentToMcpRecommendation,
  securityDeploymentVerdictLabel,
} from "@/server/ai-red-team/decision/production-verdict-bridge";
import { globalProjectDecisionStore } from "@/server/ai-red-team/decision/project-decision-store";

export type SecurityDecisionMcpOverlay = {
  applied: boolean;
  deploymentVerdict: string | null;
  deploymentRecommendation: "SHIP_IT" | "DO_NOT_DEPLOY" | "MORE_ANALYSIS_REQUIRED" | null;
  executiveSummarySuffix: string | null;
  verdict: ProductionVerdictV1;
};

/**
 * When a Security Decision exists for this project/commit, it becomes the
 * authoritative deployment verdict for MCP deploy answers (no new MCP tools).
 */
export function applyLatestSecurityDecisionToVerdict(
  projectId: string,
  verdict: ProductionVerdictV1,
  options?: { organizationId?: string | null }
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

  const snapshot = globalProjectDecisionStore.getLatest(projectId, {
    organizationId: options?.organizationId,
  });
  if (!snapshot) {
    return {
      applied: false,
      deploymentVerdict: null,
      deploymentRecommendation: null,
      executiveSummarySuffix: null,
      verdict,
    };
  }

  if (
    snapshot.commitSha &&
    verdict.commitSha &&
    snapshot.commitSha !== verdict.commitSha
  ) {
    return {
      applied: false,
      deploymentVerdict: null,
      deploymentRecommendation: null,
      executiveSummarySuffix: null,
      verdict,
    };
  }

  console.warn(
    JSON.stringify({
      event: "security_decision_in_memory_fallback",
      projectId,
      organizationId: options?.organizationId ?? null,
      snapshotCommitSha: snapshot.commitSha,
      verdictCommitSha: verdict.commitSha,
    })
  );

  const merged = applySecurityDecisionToProductionVerdict(verdict, snapshot.report);
  return {
    applied: true,
    deploymentVerdict: merged.securityDeploymentVerdict,
    deploymentRecommendation: mapSecurityDeploymentToMcpRecommendation(
      merged.securityDeploymentVerdict
    ),
    executiveSummarySuffix: `Security Decision: ${securityDeploymentVerdictLabel(merged.securityDeploymentVerdict)}.`,
    verdict: merged,
  };
}
