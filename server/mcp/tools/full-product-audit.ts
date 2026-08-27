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
import type { FullProductAuditMcpResponse } from "@/server/full-product-audit/format-response";
import type { FullProductAuditResult } from "@/server/full-product-audit/types";
import { recordReviewStartedMemory } from "@/server/production-memory/record-writes";

export type FullProductAuditInput = ProjectSelector & {
  commitSha?: string;
  branch?: string;
  dynamicVerificationDecision?: "authorize" | "static_only";
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

/**
 * MCP clients should receive a structured response before platform timeouts.
 * Combined budget must stay under 120s (HTTP tool response ceiling for MCP
 * clients -- see the "sized for HTTP tool responses" test). An even 50/50
 * split undershot real scan durations on repos of even moderate size
 * (observed 33-56s for a ~1900-file repo), causing the review to legitimately
 * still be running server-side when the client gave up and reported a
 * partial/timed-out result on nearly every call. Security tests only run
 * when the caller explicitly authorizes dynamic verification, so the review
 * -- which every call goes through -- gets the larger share.
 */
export const MCP_FULL_PRODUCT_AUDIT_REVIEW_WAIT_MS = 85_000;
export const MCP_FULL_PRODUCT_AUDIT_SECURITY_WAIT_MS = 30_000;

export async function fullProductAudit(
  ctx: McpAuthContext,
  input: FullProductAuditInput,
  t: McpTranslator
): Promise<FullProductAuditMcpResponse> {
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
      waitForReviewMs: MCP_FULL_PRODUCT_AUDIT_REVIEW_WAIT_MS,
      waitForSecurityTestsMs: MCP_FULL_PRODUCT_AUDIT_SECURITY_WAIT_MS,
      dynamicVerificationDecision: input.dynamicVerificationDecision,
    });
  } catch (error) {
    if (error instanceof FullProductAuditError) {
      const status = ERROR_STATUS[error.code] ?? error.status;
      const message = t(`errors.${error.code}`) || error.message;
      throw new McpError(status, error.code, message);
    }
    throw error;
  }

  if (result.reviewId) {
    void recordReviewStartedMemory(ctx.admin, {
      organizationId: ctx.organizationId,
      projectId: result.project.id,
      scanId: result.reviewId,
      trigger: "mcp",
      reason: "manual_check",
    });
  }

  return formatFullProductAuditResponse(result, t);
}
