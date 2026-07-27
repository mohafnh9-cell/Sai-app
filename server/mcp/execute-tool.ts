import "server-only";

import type { McpAuthContext } from "./auth";
import { McpError } from "./auth";
import { getMcpTranslator, resolveMcpLocale } from "./i18n";
import { logMcpCall } from "./observability";
import { recordOperationDuration } from "@/server/observability/operation-timing";
import { MCP_PUBLIC_TOOL_NAMES } from "./tool-definitions";
import { cancelReview } from "./tools/cancel-review";
import { canIDeploy } from "./tools/can-i-deploy";
import { productionHistory } from "./tools/production-history";
import { reviewNow } from "./tools/review-now";
import { safeFix } from "./tools/safe-fix";
import { whatChanged } from "./tools/what-changed";
import { discoverApplication } from "./tools/discover-application";
import type { VerdictStatus } from "@/brain/production-verdict/schema";
import { deployAnswerFromVerdictStatus } from "@/server/production-memory/types";
import {
  recordDeployCheckMemory,
  recordReviewStartedMemory,
  recordSafeFixMemory,
} from "@/server/production-memory/record-writes";
import { enrichMcpToolResultWithAlerts } from "@/server/security-alerts/mcp-enrichment";
import { evaluateDeployCheckAlert } from "@/server/security-alerts/evaluate-project";
import { enrichMcpToolResultWithReports } from "@/server/protection-reports/mcp-enrichment";

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function range(value: unknown): "7d" | "30d" | "all" | undefined {
  return value === "7d" || value === "30d" || value === "all" ? value : undefined;
}

function reason(value: unknown): "before_deploy" | "after_fix" | "manual_check" | undefined {
  return value === "before_deploy" || value === "after_fix" || value === "manual_check" ? value : undefined;
}

function projectSelector(input: Record<string, unknown>) {
  return {
    projectId: str(input.projectId),
    repositoryId: str(input.repositoryId),
    repositoryFullName: str(input.repositoryFullName),
  };
}

/**
 * ADR-001 / MCP V1: this switch may only dispatch to the exactly-five
 * canonical public tools registered in ./tool-definitions.ts.
 */
export async function executeMcpTool(
  ctx: McpAuthContext,
  toolName: string,
  input: Record<string, unknown>
): Promise<unknown> {
  if (!MCP_PUBLIC_TOOL_NAMES.includes(toolName)) {
    throw new McpError(404, "unknown_tool", `Unknown tool: ${toolName}`);
  }

  const startedAt = Date.now();
  const locale = await resolveMcpLocale(ctx.admin, ctx.userId, str(input.locale));
  const t = getMcpTranslator(locale);

  try {
    const result = await dispatch(ctx, toolName, input, t);
    let enriched: unknown = result;
    if (toolName === "safe_fix") {
      enriched = result;
    } else if (
      toolName === "can_i_deploy" ||
      toolName === "what_changed" ||
      toolName === "production_history"
    ) {
      const base = result as { summary?: string; project?: { id?: string }; range?: string };
      enriched = await enrichMcpToolResultWithAlerts(ctx.admin, toolName, base);
      enriched = await enrichMcpToolResultWithReports(ctx.admin, toolName, {
        ...(enriched as object),
        range: toolName === "production_history" ? (range(input.range) ?? "all") : undefined,
      } as { summary?: string; project?: { id?: string }; range?: string });
    }
    logMcpCall({
      tool: toolName,
      organizationId: ctx.organizationId,
      projectId: (result as { project?: { id?: string } })?.project?.id ?? null,
      durationMs: Date.now() - startedAt,
      result: "success",
    });
    recordOperationDuration("mcp.tool", Date.now() - startedAt, {
      organizationId: ctx.organizationId,
      tool: toolName,
    });
    return enriched;
  } catch (error) {
    logMcpCall({
      tool: toolName,
      organizationId: ctx.organizationId,
      durationMs: Date.now() - startedAt,
      result: "error",
      errorCode: error instanceof McpError ? error.code : "internal_error",
    });
    throw error;
  }
}

async function dispatch(
  ctx: McpAuthContext,
  toolName: string,
  input: Record<string, unknown>,
  t: ReturnType<typeof getMcpTranslator>
): Promise<unknown> {
  switch (toolName) {
    case "cancel_review": {
      return cancelReview(
        ctx,
        {
          ...projectSelector(input),
          reviewId: str(input.reviewId),
        },
        t
      );
    }

    case "review_now": {
      const result = await reviewNow(
        ctx,
        {
          ...projectSelector(input),
          commitSha: str(input.commitSha),
          branch: str(input.branch),
          reason: reason(input.reason),
        },
        t
      );
      if (result.status === "queued" && result.reviewId) {
        void recordReviewStartedMemory(ctx.admin, {
          organizationId: ctx.organizationId,
          projectId: result.project.id,
          scanId: result.reviewId,
          trigger: "mcp",
          reason: reason(input.reason),
        });
      }
      return result;
    }

    case "can_i_deploy": {
      const result = await canIDeploy(ctx, projectSelector(input), t);
      const deployAnswer = deployAnswerFromVerdictStatus(result.verdictStatus as VerdictStatus);
      void recordDeployCheckMemory(ctx.admin, {
        organizationId: ctx.organizationId,
        projectId: result.project.id,
        deployAnswer,
        productionConfidence: result.score,
        securityConfidence: result.score,
        stale: result.stale,
        primaryBlockerPlain: result.topBlockers[0]?.title ?? null,
        source: "mcp",
      });
      void evaluateDeployCheckAlert(ctx.admin, {
        organizationId: ctx.organizationId,
        projectId: result.project.id,
        projectName: result.project.name,
        deployAnswer,
        primaryWorry: result.topBlockers[0]?.title ?? null,
      });
      return result;
    }

    case "safe_fix": {
      const result = await safeFix(
        ctx,
        {
          ...projectSelector(input),
          blockerId: str(input.blockerId),
          priorityId: str(input.priorityId),
          findingId: str(input.findingId),
        },
        t
      );
      if (result.status === "prompt_ready") {
        void recordSafeFixMemory(ctx.admin, {
          organizationId: ctx.organizationId,
          projectId: result.project.id,
          recommendationId: result.blocker.id,
          titlePlain: result.blocker.title,
          severity: result.blocker.severity,
        });
      }
      const { enrichMcpSafeFixWithV2 } = await import("@/server/safe-fix-engine/mcp-enrichment");
      return enrichMcpSafeFixWithV2(ctx.admin, ctx.organizationId, result);
    }

    case "what_changed":
      return whatChanged(ctx, projectSelector(input), t);

    case "production_history":
      return productionHistory(
        ctx,
        {
          ...projectSelector(input),
          range: range(input.range),
          limit: num(input.limit),
        },
        t
      );

    case "discover_application":
      return discoverApplication(
        ctx,
        {
          ...projectSelector(input),
          branch: str(input.branch),
        },
        t
      );

    default:
      throw new McpError(404, "unknown_tool", `Unknown tool: ${toolName}`);
  }
}
