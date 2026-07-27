import "server-only";

import { McpError } from "../auth";
import type { McpAuthContext } from "../auth";
import type { McpTranslator } from "../i18n";
import type { ProjectSelector } from "../project-resolution";
import { resolveMcpProject } from "../project-resolution";
import {
  CancelProductionReviewError,
  cancelProductionReview,
} from "@/server/review-cancel/cancel-production-review";
import { isActiveReviewScanStatus } from "@/brain/automatic-review/review-status";

export type CancelReviewInput = ProjectSelector & {
  reviewId?: string;
};

export type CancelReviewResult = {
  mode: "production_review_cancel";
  project: { id: string; name: string; repositoryFullName: string | null };
  reviewId: string | null;
  cancelled: boolean;
  summary: string;
};

export async function cancelReview(
  ctx: McpAuthContext,
  input: CancelReviewInput,
  t: McpTranslator
): Promise<CancelReviewResult> {
  const project = await resolveMcpProject(ctx, input, t);

  let reviewId = input.reviewId?.trim() || null;
  if (!reviewId) {
    const { data: active } = await ctx.admin
      .from("scans")
      .select("id, status")
      .eq("repository_id", project.id)
      .order("created_at", { ascending: false })
      .limit(5);

    reviewId =
      (active ?? []).find((row) => isActiveReviewScanStatus(String(row.status)))?.id ?? null;
  }

  if (!reviewId) {
    return {
      mode: "production_review_cancel",
      project,
      reviewId: null,
      cancelled: false,
      summary: t("cancel_review.none_active"),
    };
  }

  try {
    const result = await cancelProductionReview(ctx.admin, {
      reviewId,
      projectId: project.id,
      cancelledByUserId: ctx.userId,
    });
    return {
      mode: "production_review_cancel",
      project,
      reviewId,
      cancelled: result.cancelled,
      summary: t("cancel_review.success", { reviewId }),
    };
  } catch (error) {
    if (error instanceof CancelProductionReviewError) {
      throw new McpError(409, "not_cancellable", error.message);
    }
    throw error;
  }
}
