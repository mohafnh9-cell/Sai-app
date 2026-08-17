import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseGitHubRepository } from "@/lib/github/repository-reference";
import { GitHubRepositoryService } from "@/lib/github/repository-service";
import { resolveOrganizationGitHubToken } from "@/server/github-automation/token-resolver";
import { refreshGitHubHeadForProject } from "@/server/repository-sync/refresh-github-head";
import type { DiscoveryRepositoryInput } from "../types";

export async function loadDiscoveryRepositoryFromProject(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    branch?: string | null;
    commitSha?: string | null;
  }
): Promise<DiscoveryRepositoryInput> {
  const { data: project, error } = await admin
    .from("projects")
    .select("id, organization_id, github_repo, name")
    .eq("id", input.projectId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  if (error || !project?.github_repo) {
    throw new Error("Project GitHub repository is not connected");
  }

  const tokenResult = await resolveOrganizationGitHubToken(
    admin,
    input.organizationId,
    input.projectId
  );
  if (!tokenResult) {
    throw new Error("No GitHub token available for discovery");
  }

  const ref = parseGitHubRepository(project.github_repo as string);
  const service = new GitHubRepositoryService(tokenResult.token);
  let commitSha = input.commitSha?.trim() || null;
  let branch = input.branch?.trim() || null;
  try {
    if (!input.commitSha?.trim()) {
      const head = await refreshGitHubHeadForProject(admin, {
        organizationId: input.organizationId,
        projectId: input.projectId,
        githubRepo: project.github_repo as string,
        branch,
        githubService: service,
      });
      if (!head?.commitSha) {
        throw new Error("Could not resolve GitHub HEAD for discovery");
      }
      commitSha = head.commitSha;
      branch = head.branch;
    }

    const snapshot = await service.fetchSnapshot(ref, {
      branch: branch ?? undefined,
      commitSha: commitSha ?? undefined,
    });

    return {
      projectId: project.id as string,
      organizationId: project.organization_id as string,
      commitSha: snapshot.commitSha,
      defaultBranch: snapshot.defaultBranch,
      repositoryLabel: (project.name as string | null) ?? `${ref.owner}/${ref.repo}`,
      files: snapshot.files.map((file) => ({ path: file.path, content: file.content })),
    };
  } finally {
    service.dispose();
  }
}
