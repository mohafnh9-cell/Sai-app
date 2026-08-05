import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { requireProjectApiAccess } from "@/server/projects/project-access";
import { getProductionReviewState } from "@/server/review-cancel/get-production-review-state";
import {
  getCurrentProductionVerdict,
  getProductionVerdictByScan,
} from "@/server/production-verdict/service";
import { refreshGitHubHeadForProject } from "@/server/repository-sync/refresh-github-head";
import { buildProductionReviewUiContract } from "@/server/projects/build-production-review-ui-contract";
import { isFeatureEnabled } from "@/server/feature-flags";
import {
  requestedAnalysisRunIdFromRequest,
  resolveAnalysisRunIdForIsolation,
} from "@/server/analysis-runs/resolve-analysis-run-id-for-isolation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const paramsSchema = z.object({
  id: z.string().uuid(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }

  const projectId = parsed.data.id;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const access = await requireProjectApiAccess(supabase, user?.id, projectId);
  if (!access.ok) return access.response;

  const admin = createAdminClient();
  const organizationId = access.project.organization_id;
  const isolationEnabled = isFeatureEnabled("analysis_run_isolation", { organizationId });
  const { runId: analysisRunId, invalidRequest } = await resolveAnalysisRunIdForIsolation(admin, {
    projectId,
    organizationId,
    requestedRunId: requestedAnalysisRunIdFromRequest(request),
    isolationEnabled,
  });
  if (invalidRequest) {
    return NextResponse.json({ error: "Invalid analysis run" }, { status: 400 });
  }

  const { data: projectRow } = await admin
    .from("projects")
    .select("github_repo, github_repository_id")
    .eq("id", projectId)
    .eq("organization_id", access.project.organization_id)
    .maybeSingle();

  const contract = await buildProductionReviewUiContract(admin, {
    organizationId: access.project.organization_id,
    projectId,
  });

  const state = await getProductionReviewState(admin, {
    organizationId,
    projectId,
  });

  const verdict =
    isolationEnabled && analysisRunId
      ? await getProductionVerdictByScan(admin, analysisRunId)
      : await getCurrentProductionVerdict(admin, projectId);
  const lastVerdictCommitSha = verdict?.commitSha ?? null;

  let githubHeadSha: string | null = contract?.github.headCommitSha ?? null;
  if (!githubHeadSha && projectRow?.github_repo) {
    const head = await refreshGitHubHeadForProject(admin, {
      organizationId: access.project.organization_id,
      projectId,
      githubRepo: projectRow.github_repo as string,
      githubRepositoryId: (projectRow.github_repository_id as number | null) ?? null,
    }).catch(() => null);
    githubHeadSha = head?.commitSha ?? null;
  }

  const githubSync = {
    githubHeadSha,
    analyzedCommitSha:
      contract?.latestCompletedReview?.commitSha ??
      (contract?.reviewInProgress ? contract.activeReview?.commitSha : null) ??
      lastVerdictCommitSha,
    lastVerdictCommitSha,
    activeReviewCommitSha: contract?.activeReview?.commitSha ?? state.commitSha,
    repositoryOutOfSync: contract?.repositoryOutOfSync ?? false,
    syncInProgress: contract?.reviewInProgress ?? false,
  };

  let activeScanProgress: { progress: number | null; progressMessage: string | null } | null =
    null;
  if (contract?.reviewInProgress && contract.activeReview?.scanId) {
    const { data: scanRow } = await admin
      .from("scans")
      .select("progress, progress_message")
      .eq("id", contract.activeReview.scanId)
      .maybeSingle();
    activeScanProgress = {
      progress: (scanRow?.progress as number | null) ?? null,
      progressMessage: (scanRow?.progress_message as string | null) ?? null,
    };
  }

  return NextResponse.json(
    {
      contract,
      state,
      githubSync,
      activeScanProgress,
      analysisRunId: isolationEnabled ? analysisRunId : null,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
