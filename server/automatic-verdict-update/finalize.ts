import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildFinalizeFailure,
  buildFinalizeSuccess,
  shouldFinalizeAutomaticVerdict,
  type AutomaticVerdictFinalizeResult,
} from "@/brain/automatic-verdict-update";
import {
  generateAndPersistProductionVerdict,
  getProductionVerdictByScan,
} from "@/server/production-verdict/service";

function log(event: string, fields: Record<string, unknown>) {
  console.info({ component: "automatic-verdict-update", event, ...fields });
}

export async function finalizeProjectStateAfterAutomaticReview(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    scanId: string;
  }
): Promise<AutomaticVerdictFinalizeResult> {
  const { data: scan, error: scanError } = await admin
    .from("scans")
    .select(
      "id, status, review_type, commit_sha, security_score, findings_count, completed_at"
    )
    .eq("id", input.scanId)
    .eq("project_id", input.projectId)
    .maybeSingle();

  if (scanError) {
    log("scan_read_failed", { scanId: input.scanId, message: scanError.message });
    return buildFinalizeFailure("missing_review", input.scanId);
  }

  const decision = shouldFinalizeAutomaticVerdict(scan);
  if (!decision.shouldFinalize) {
    return buildFinalizeFailure(decision.errorCode, scan?.id ?? input.scanId);
  }

  const existingVerdict = await getProductionVerdictByScan(
    admin,
    input.organizationId,
    input.scanId
  );
  if (existingVerdict) {
    log("verdict_already_current", { scanId: input.scanId, projectId: input.projectId });
    return buildFinalizeSuccess(input.scanId);
  }

  if (scan!.security_score != null && scan!.completed_at) {
    const { error: projectError } = await admin
      .from("projects")
      .update({
        security_score: scan!.security_score,
        last_scan_at: scan!.completed_at,
      })
      .eq("id", input.projectId)
      .eq("organization_id", input.organizationId);

    if (projectError) {
      log("project_score_update_failed", {
        scanId: input.scanId,
        message: projectError.message,
      });
    }
  }

  try {
    const verdict = await generateAndPersistProductionVerdict(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      scanId: input.scanId,
    });

    if (!verdict) {
      log("verdict_generation_failed", { scanId: input.scanId });
      return buildFinalizeFailure("verdict_generation_failed", input.scanId);
    }

    await admin
      .from("repository_scan_state")
      .upsert(
        {
          repository_id: input.projectId,
          organization_id: input.organizationId,
          last_full_scan_at: scan!.completed_at,
          open_findings_count: scan!.findings_count ?? 0,
          last_commit_sha: scan!.commit_sha,
        },
        { onConflict: "repository_id" }
      );

    log("verdict_update_completed", {
      scanId: input.scanId,
      projectId: input.projectId,
      status: verdict.status,
      score: verdict.score,
    });

    return buildFinalizeSuccess(input.scanId);
  } catch (error) {
    log("verdict_generation_failed", {
      scanId: input.scanId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return buildFinalizeFailure("verdict_generation_failed", input.scanId);
  }
}
