import "server-only";

import { McpError } from "../auth";
import type { McpAuthContext } from "../auth";
import type { McpTranslator } from "../i18n";
import type { ProjectSelector } from "../project-resolution";
import { resolveMcpProject } from "../project-resolution";
import {
  formatFullProductAuditResponse,
  FullProductAuditError,
  runFullProductAudit,
} from "@/server/full-product-audit";
import type { FullProductAuditResult } from "@/server/full-product-audit/types";

export type FullProductAuditInput = ProjectSelector & {
  commitSha?: string;
  branch?: string;
};

const ERROR_STATUS: Record<string, number> = {
  repository_disconnected: 422,
  invalid_commit: 422,
  commit_not_found: 404,
  review_creation_failed: 500,
  review_failed: 422,
  rate_limited: 429,
  internal_error: 500,
};

export async function fullProductAudit(
  ctx: McpAuthContext,
  input: FullProductAuditInput,
  t: McpTranslator
): Promise<FullProductAuditResult> {
  const project = await resolveMcpProject(ctx, input, t);

  const { data: projectRow } = await ctx.admin
    .from("projects")
    .select("github_repo, github_repository_id")
    .eq("id", project.id)
    .maybeSingle();

  let result: FullProductAuditResult;
  try {
    result = await runFullProductAudit(ctx.admin, {
      organizationId: ctx.organizationId,
      projectId: project.id,
      projectName: project.name,
      repositoryFullName: project.repositoryFullName,
      githubRepo: (projectRow?.github_repo as string | null) ?? null,
      githubRepositoryId: (projectRow?.github_repository_id as number | null) ?? null,
      commitSha: input.commitSha,
      branch: input.branch,
    });
  } catch (error) {
    if (error instanceof FullProductAuditError) {
      const status = ERROR_STATUS[error.code] ?? error.status;
      const message = t(`errors.${error.code}`) || error.message;
      throw new McpError(status, error.code, message);
    }
    throw error;
  }

  return formatFullProductAuditResponse(result, t);
}
