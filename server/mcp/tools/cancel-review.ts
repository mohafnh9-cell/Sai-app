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
import { loadActiveReviewForBranch } from "@/server/automatic-review/queries";

export type CancelReviewInput = ProjectSelector & {
  reviewId?: string;
  /** Branch whose active review to cancel when no reviewId is given. Defaults to the default branch. */
  branch?: string;
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
    // Without an explicit review id the target is the active review of ONE
    // branch scope: the requested branch, else the default branch. It is
    // never "the newest active review of the project": another branch's
    // review is never selected, so an ambiguous request fails closed
    // (nothing is cancelled).
    const active = await loadActiveReviewForBranch(ctx.admin, project.id, input.branch?.trim() || null);
    reviewId = active?.id ?? null;
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
