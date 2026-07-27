import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getScanRequestContext,
  ScanRequestError,
} from "@/server/security-scanner/request-context";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import {
  CancelProductionReviewError,
  cancelProductionReview,
} from "@/server/review-cancel/cancel-production-review";
import { enforceRateLimit } from "@/server/http/rate-limit";

const paramsSchema = z.object({
  repositoryId: z.string().uuid(),
  scanId: z.string().uuid(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ repositoryId: string; scanId: string }> }
) {
  try {
    const rateLimited = enforceRateLimit(request);
    if (rateLimited) return rateLimited;

    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid repository or scan id" }, { status: 400 });
    }

    const { repositoryId, scanId } = parsed.data;
    const { user } = await getScanRequestContext(repositoryId);

    const admin = createAdminClient();
    const result = await cancelProductionReview(admin, {
      reviewId: scanId,
      projectId: repositoryId,
      cancelledByUserId: user.id,
    });

    return NextResponse.json({
      cancelled: result.cancelled,
      idempotent: result.idempotent,
      scanId: result.reviewId,
      status: result.status,
    });
  } catch (error) {
    if (error instanceof CancelProductionReviewError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    if (error instanceof ScanRequestError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    console.error({
      component: "scan-cancel-api",
      event: "request_failed",
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ error: "Could not cancel review" }, { status: 500 });
  }
}
