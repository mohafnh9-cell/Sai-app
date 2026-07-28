import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseGitHubRepository,
  resolveCommitReference,
  GitHubServiceError,
} from "@/lib/github/repository-service";
import { resolveOrganizationGitHubToken } from "@/server/github-automation/token-resolver";
import { recordLiveHeadCommit } from "./persistence";
import { commitsMatch } from "@/lib/repository-sync/commits-match";

export type ResolvedGitHubHead = {
  commitSha: string;
  branch: string;
};

export async function refreshGitHubHeadForProject(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    githubRepo: string;
    githubRepositoryId?: number | null;
    branch?: string | null;
  }
): Promise<ResolvedGitHubHead | null> {
  const tokenResult = await resolveOrganizationGitHubToken(
    admin,
    input.organizationId,
    input.projectId
  );
  if (!tokenResult?.token) return null;

  try {
    const ref = parseGitHubRepository(input.githubRepo);
    const resolved = await resolveCommitReference(tokenResult.token, ref, {
      branch: input.branch ?? undefined,
    });
    await recordLiveHeadCommit(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      githubRepositoryId: input.githubRepositoryId ?? null,
      commitSha: resolved.sha,
      branch: resolved.branch ?? input.branch ?? "main",
    });
    await admin
      .from("projects")
      .update({
        github_last_commit_sha: resolved.sha,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.projectId)
      .eq("organization_id", input.organizationId);

    return {
      commitSha: resolved.sha,
      branch: resolved.branch ?? input.branch ?? "main",
    };
  } catch (error) {
    if (error instanceof GitHubServiceError) {
      console.warn({
        component: "refresh-github-head",
        event: "head_refresh_failed",
        projectId: input.projectId,
        code: error.code,
      });
    }
    return null;
  }
}

export { commitsMatch } from "@/lib/repository-sync/commits-match";
