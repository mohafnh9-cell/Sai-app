import { NextResponse } from "next/server";
import { z } from "zod";
import { assertInternalOpsAuthorized } from "@/lib/auth/internal-ops";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { repairMalformedGitHubRepoUrls } from "@/server/github/repair-github-repo-urls";
import {
  recoverReviewById,
  recoverStaleActiveReviewsForProject,
} from "@/server/review-recovery/stale-review";
import { triggerProductionReview } from "@/server/review-now/trigger-review";
import { toFounderErrorResponse } from "@/server/errors";

export const runtime = "nodejs";

const bodySchema = z
  .object({
    projectId: z.string().uuid().optional(),
    reviewId: z.string().uuid().optional(),
    forceReviewRecovery: z.boolean().optional(),
    repairGithubRepo: z.boolean().optional(),
    triggerReviewCommitSha: z.string().min(7).max(64).optional(),
    triggerReviewBranch: z.string().min(1).max(255).optional(),
  })
  .strict();

export async function POST(request: Request) {
  const unauthorized = assertInternalOpsAuthorized(request);
  if (unauthorized) return unauthorized;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  try {
    const admin = createAdminClient();
    const result: Record<string, unknown> = {};

    if (parsed.data.repairGithubRepo !== false) {
      result.githubRepoRepairs = await repairMalformedGitHubRepoUrls(admin, {
        projectId: parsed.data.projectId,
      });
    }

    if (parsed.data.projectId) {
      result.staleReviewRecovery = await recoverStaleActiveReviewsForProject(
        admin,
        parsed.data.projectId
      );
    }

    if (parsed.data.reviewId) {
      result.reviewRecovery = await recoverReviewById(admin, parsed.data.reviewId, {
        force: parsed.data.forceReviewRecovery ?? false,
      });
    }

    if (parsed.data.projectId && parsed.data.triggerReviewCommitSha) {
      const { data: project } = await admin
        .from("projects")
        .select("id, organization_id, github_repo, github_repository_id")
        .eq("id", parsed.data.projectId)
        .maybeSingle();
      if (!project?.organization_id) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
      result.triggeredReview = await triggerProductionReview(admin, {
        organizationId: project.organization_id as string,
        projectId: project.id as string,
        githubRepo: (project.github_repo as string | null) ?? null,
        githubRepositoryId: (project.github_repository_id as number | null) ?? null,
        requestedCommitSha: parsed.data.triggerReviewCommitSha,
        requestedBranch: parsed.data.triggerReviewBranch,
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    const safe = toFounderErrorResponse(error);
    return NextResponse.json(safe, { status: 500 });
  }
}
