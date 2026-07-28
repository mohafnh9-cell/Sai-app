import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { requireProjectApiAccess } from "@/server/projects/project-access";
import { getProductionReviewState } from "@/server/review-cancel/get-production-review-state";
import { getCurrentProductionVerdict } from "@/server/production-verdict/service";
import { getGitHubSyncSnapshot } from "@/server/repository-sync/github-sync-snapshot";

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

  const state = await getProductionReviewState(admin, {
    organizationId: access.project.organization_id,
    projectId,
  });

  const verdict = await getCurrentProductionVerdict(admin, projectId);
  const analyzedCommitSha = state.commitSha ?? verdict?.commitSha ?? null;

  let githubSync = {
    githubHeadSha: null as string | null,
    analyzedCommitSha,
    repositoryOutOfSync: false,
  };

  if (projectRow?.github_repo) {
    githubSync = await getGitHubSyncSnapshot(admin, {
      organizationId: access.project.organization_id,
      projectId,
      githubRepo: projectRow.github_repo as string,
      githubRepositoryId: (projectRow.github_repository_id as number | null) ?? null,
      analyzedCommitSha,
      refreshRemote: true,
    });
  }

  return NextResponse.json(
    { state, githubSync },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
