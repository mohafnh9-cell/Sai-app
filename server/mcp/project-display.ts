import { normalizeStoredGitHubRepository } from "@/lib/github/repository-reference";

export type ResolvedMcpProject = {
  id: string;
  name: string;
  repositoryFullName: string | null;
};

export function formatMcpRepositoryFullName(storedGithubRepo: string | null): string | null {
  return normalizeStoredGitHubRepository(storedGithubRepo) ?? storedGithubRepo;
}

export function toResolvedMcpProject(project: {
  id: string;
  name: string;
  github_repo: string | null;
}): ResolvedMcpProject {
  return {
    id: project.id,
    name: project.name,
    repositoryFullName: formatMcpRepositoryFullName(project.github_repo),
  };
}
