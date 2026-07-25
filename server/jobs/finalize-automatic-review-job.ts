import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { AUTOMATIC_VERDICT_UPDATE_CONFIG } from "@/brain/automatic-verdict-update";
import { finalizeProjectStateAfterAutomaticReview } from "@/server/automatic-verdict-update";
import {
  buildIdempotencyKey,
  runIdempotentSideEffect,
} from "@/server/observability/idempotency";

export async function finalizeAutomaticReviewJob(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    scanId: string;
  }
): Promise<{ verdictUpdated: boolean; verdictError?: string }> {
  if (!AUTOMATIC_VERDICT_UPDATE_CONFIG.enabled) {
    return { verdictUpdated: false };
  }

  const idempotencyKey = buildIdempotencyKey({
    organizationId: input.organizationId,
    projectId: input.projectId,
    scanId: input.scanId,
    operationType: "automatic_review_finalize",
  });

  const result = await runIdempotentSideEffect(
    admin,
    {
      idempotencyKey,
      organizationId: input.organizationId,
      projectId: input.projectId,
      scanId: input.scanId,
      operationType: "automatic_review_finalize",
    },
    async () =>
      finalizeProjectStateAfterAutomaticReview(admin, {
        organizationId: input.organizationId,
        projectId: input.projectId,
        scanId: input.scanId,
      })
  );

  if (result.duplicate) {
    return { verdictUpdated: false };
  }

  const finalizeResult = result.result;
  if (!finalizeResult) {
    return { verdictUpdated: false };
  }

  return {
    verdictUpdated: finalizeResult.verdictUpdated,
    ...(finalizeResult.ok || !finalizeResult.errorCode
      ? {}
      : { verdictError: finalizeResult.errorCode }),
  };
}
