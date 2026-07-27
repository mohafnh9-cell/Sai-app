import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { requireProjectApiAccess } from "@/server/projects/project-access";
import {
  CancelProductionReviewError,
  cancelProductionReview,
} from "@/server/review-cancel/cancel-production-review";
import { enforceRateLimit } from "@/server/http/rate-limit";

const paramsSchema = z.object({
  id: z.string().uuid(),
  reviewId: z.string().uuid(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; reviewId: string }> }
) {
  try {
    const rateLimited = enforceRateLimit(request);
    if (rateLimited) return rateLimited;

    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid project or review id" }, { status: 400 });
    }

    const { id: projectId, reviewId } = parsed.data;
    const supabase = await createClient();
    const access = await requireProjectApiAccess(supabase, projectId);
    if (!access.ok) return access.response;

    const admin = createAdminClient();
    const result = await cancelProductionReview(admin, {
      reviewId,
      projectId,
      cancelledByUserId: access.userId,
    });

    return NextResponse.json({
      cancelled: result.cancelled,
      idempotent: result.idempotent,
      reviewId: result.reviewId,
      status: result.status,
    });
  } catch (error) {
    if (error instanceof CancelProductionReviewError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    console.error({
      component: "project-review-cancel-api",
      event: "request_failed",
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ error: "Could not cancel review" }, { status: 500 });
  }
}
