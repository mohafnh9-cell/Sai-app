import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { requireProjectApiAccess } from "@/server/projects/project-access";
import { getProductionReviewState } from "@/server/review-cancel/get-production-review-state";
import { getCurrentProductionVerdict } from "@/server/production-verdict/service";
import { refreshGitHubHeadForProject } from "@/server/repository-sync/refresh-github-head";
import { buildProductionReviewUiContract } from "@/server/projects/build-production-review-ui-contract";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const paramsSchema = z.object({
  id: z.string().uuid(),
});

export async function GET(
  _request: Request,
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
    organizationId: access.project.organization_id,
    projectId,
  });

  const verdict = await getCurrentProductionVerdict(admin, projectId);
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

  return NextResponse.json(
    {
      contract,
      state,
      githubSync,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
