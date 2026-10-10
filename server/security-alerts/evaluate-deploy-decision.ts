import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { McpAuthContext } from "@/server/mcp/auth";
import { getMcpTranslator } from "@/server/mcp/i18n";
import { canIDeploy, type CanIDeployResult } from "@/server/mcp/tools/can-i-deploy";
import type { DeployAlertDecisionInput } from "./deploy-alert-decision";
import { evaluateDeployCheckAlert } from "./evaluate-project";

/** Maps the canonical decision `can_i_deploy` answers with to the input of the deploy-alert policy (one mapping, one place). */
export function deployAlertInputFromCanIDeploy(
  result: Pick<
    CanIDeployResult,
    | "deploymentRecommendation"
    | "verdictStatus"
    | "reviewInProgress"
    | "reviewFailed"
    | "freshnessStatus"
    | "topBlockers"
    | "verdictScanId"
  >
): DeployAlertDecisionInput {
  return {
    deploymentRecommendation: result.deploymentRecommendation,
    verdictStatus: result.verdictStatus,
    reviewInProgress: result.reviewInProgress,
    reviewFailed: result.reviewFailed,
    freshnessStatus: result.freshnessStatus,
    hasActionableFinding: result.topBlockers.length > 0,
    verdictScanId: result.verdictScanId,
    primaryWorry: result.topBlockers[0]?.title ?? null,
  };
}

/**
 * The scheduled owner of the "deploy check" alert (the daily per-project evaluation). Reading the deploy answer through
 * `can_i_deploy` no longer creates alerts: this evaluates the SAME canonical decision on a schedule, so a person's
 * status query has no visible side effect and an alert exists once per decision (the dedupe key binds it to the scan).
 */
export async function evaluateDeployDecisionAlert(
  admin: SupabaseClient,
  projectId: string
): Promise<{ evaluated: boolean }> {
  const { data: project } = await admin
    .from("projects")
    .select("id, name, organization_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { evaluated: false };

  // canIDeploy only needs the organization boundary and the service client; this is a system actor, not a person's token.
  const ctx: McpAuthContext = {
    authType: "api_key",
    organizationId: project.organization_id as string,
    userId: "system:alerts-daily",
    admin,
    scopes: [],
    source: "legacy_api_key",
  };

  let result: CanIDeployResult;
  try {
    result = await canIDeploy(ctx, { projectId }, getMcpTranslator("en"));
  } catch {
    // No verdict yet (or the project cannot be resolved): there is no decision to warn about.
    return { evaluated: false };
  }

  await evaluateDeployCheckAlert(admin, {
    organizationId: project.organization_id as string,
    projectId,
    projectName: (project.name as string) ?? result.project.name,
    decision: deployAlertInputFromCanIDeploy(result),
  });
  return { evaluated: true };
}
