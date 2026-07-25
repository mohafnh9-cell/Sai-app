import "server-only";

import type { McpAuthContext } from "./auth";
import { McpError } from "./auth";
import type { McpTranslator } from "./i18n";
import {
  normalizeStoredGitHubRepository,
  repositorySelectorMatchesStored,
} from "@/lib/github/repository-reference";
import { toResolvedMcpProject, type ResolvedMcpProject } from "./project-display";

export type { ResolvedMcpProject };

export type ProjectSelector = {
  projectId?: string;
  repositoryId?: string;
  repositoryFullName?: string;
};

/**
 * ADR-001: this module only retrieves and compares already-persisted rows
 * (projects owned by the caller's organization). It never derives verdict
 * truth — it only decides *which* project a tool call is about.
 */
export async function resolveMcpProject(
  ctx: McpAuthContext,
  selector: ProjectSelector,
  t: McpTranslator
): Promise<ResolvedMcpProject> {
  const explicitId = selector.projectId?.trim() || selector.repositoryId?.trim();

  if (explicitId) {
    const { data: project } = await ctx.admin
      .from("projects")
      .select("id, name, github_repo")
      .eq("id", explicitId)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();

    if (!project) {
      throw new McpError(404, "project_not_found", t("errors.project_not_found"));
    }
    return toResolvedMcpProject(project);
  }

  if (selector.repositoryFullName?.trim()) {
    const normalizedSelector = normalizeStoredGitHubRepository(selector.repositoryFullName.trim());
    if (normalizedSelector) {
      const { data: project } = await ctx.admin
        .from("projects")
        .select("id, name, github_repo")
        .eq("organization_id", ctx.organizationId)
        .eq("github_repo", normalizedSelector)
        .maybeSingle();
      if (project) {
        return toResolvedMcpProject(project);
      }
    }

    const { data: projects } = await ctx.admin
      .from("projects")
      .select("id, name, github_repo")
      .eq("organization_id", ctx.organizationId);

    const project = (projects ?? []).find((row) =>
      repositorySelectorMatchesStored(selector.repositoryFullName!.trim(), row.github_repo as string | null)
    );
    if (!project) {
      throw new McpError(404, "project_not_found", t("errors.project_not_found"));
    }
    return toResolvedMcpProject(project);
  }

  const { data: projects } = await ctx.admin
    .from("projects")
    .select("id, name, github_repo")
    .eq("organization_id", ctx.organizationId)
    .order("created_at", { ascending: true });

  if (!projects || projects.length === 0) {
    throw new McpError(404, "project_not_found", t("errors.project_not_found"));
  }

  if (projects.length === 1) {
    return toResolvedMcpProject(projects[0]);
  }

  throw new McpError(409, "ambiguous_project", t("errors.ambiguous_project"), {
    projects: projects.map((project) => toResolvedMcpProject(project)),
  });
}
