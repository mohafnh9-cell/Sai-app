import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshGitHubHeadForProject } from "@/server/repository-sync/refresh-github-head";
import { commitsMatch } from "@/lib/repository-sync/commits-match";
import type { GitHubRepositoryService } from "@/lib/github/repository-service";

export type GitHubSyncSnapshot = {
  githubHeadSha: string | null;
  analyzedCommitSha: string | null;
  repositoryOutOfSync: boolean;
};

export async function getGitHubSyncSnapshot(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    githubRepo: string;
    githubRepositoryId?: number | null;
    branch?: string | null;
    analyzedCommitSha?: string | null;
    refreshRemote?: boolean;
  }
): Promise<GitHubSyncSnapshot> {
  let githubHeadSha: string | null = null;

  if (input.refreshRemote !== false) {
    const head = await refreshGitHubHeadForProject(admin, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      githubRepo: input.githubRepo,
      githubRepositoryId: input.githubRepositoryId ?? null,
      branch: input.branch ?? null,
    });
    githubHeadSha = head?.commitSha ?? null;
  } else {
    const { data } = await admin
      .from("repository_sync_status")
      .select("commit_sha")
      .eq("project_id", input.projectId)
      .maybeSingle();
    githubHeadSha = (data?.commit_sha as string | null) ?? null;
  }

  const analyzedCommitSha = input.analyzedCommitSha ?? null;
  const repositoryOutOfSync =
    Boolean(githubHeadSha) &&
    Boolean(analyzedCommitSha) &&
    !commitsMatch(githubHeadSha, analyzedCommitSha);

  return { githubHeadSha, analyzedCommitSha, repositoryOutOfSync };
}

export async function alignScanWithRemoteHead(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    scanId: string;
    githubRepo: string;
    branch?: string | null;
    expectedCommitSha?: string | null;
    githubService?: GitHubRepositoryService;
  }
): Promise<{ commitSha: string; branch: string } | null> {
  const head = await refreshGitHubHeadForProject(admin, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    githubRepo: input.githubRepo,
    branch: input.branch ?? null,
    githubService: input.githubService,
  });
  if (!head) return null;

  if (
    input.expectedCommitSha &&
    !commitsMatch(head.commitSha, input.expectedCommitSha)
  ) {
    console.info({
      component: "align-scan-remote-head",
      event: "scan_commit_updated_to_remote_head",
      scanId: input.scanId,
      previousCommitSha: input.expectedCommitSha,
      remoteHeadSha: head.commitSha,
    });
  }

  await admin
    .from("scans")
    .update({
      commit_sha: head.commitSha,
      branch: head.branch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.scanId);

  return { commitSha: head.commitSha, branch: head.branch };
}
