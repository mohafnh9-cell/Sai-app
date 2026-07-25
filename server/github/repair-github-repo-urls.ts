import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isMalformedDoubleOwnerGitHubUrl,
  normalizeStoredGitHubRepository,
} from "@/lib/github/repository-reference";

export type GitHubRepoRepairResult = {
  projectId: string;
  previous: string;
  next: string;
};

export async function repairMalformedGitHubRepoUrls(
  admin: SupabaseClient,
  options?: { projectId?: string }
): Promise<GitHubRepoRepairResult[]> {
  let query = admin.from("projects").select("id, github_repo").not("github_repo", "is", null);
  if (options?.projectId) {
    query = query.eq("id", options.projectId);
  }
  const { data: projects, error } = await query;
  if (error) throw new Error(`Could not load projects for GitHub URL repair: ${error.message}`);

  const repairs: GitHubRepoRepairResult[] = [];
  for (const project of projects ?? []) {
    const current = project.github_repo as string | null;
    if (!current || !isMalformedDoubleOwnerGitHubUrl(current)) continue;
    const normalized = normalizeStoredGitHubRepository(current);
    if (!normalized || normalized === current) continue;
    const { error: updateError } = await admin
      .from("projects")
      .update({ github_repo: normalized, updated_at: new Date().toISOString() })
      .eq("id", project.id as string);
    if (updateError) {
      throw new Error(`Could not repair project ${project.id}: ${updateError.message}`);
    }
    repairs.push({ projectId: project.id as string, previous: current, next: normalized });
  }
  return repairs;
}
