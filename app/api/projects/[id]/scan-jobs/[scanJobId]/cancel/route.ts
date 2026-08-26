import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { requireProjectApiAccess } from "@/server/projects/project-access";
import {
  CancelProductionReviewError,
  cancelProductionReviewByScanJob,
} from "@/server/review-cancel/cancel-production-review";
import { enforceRateLimit } from "@/server/http/rate-limit";

const paramsSchema = z.object({
  id: z.string().uuid(),
  scanJobId: z.string().uuid(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; scanJobId: string }> }
) {
  try {
    const rateLimited = await enforceRateLimit(request);
    if (rateLimited) return rateLimited;

    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid project or scan job id" }, { status: 400 });
    }

    const { id: projectId, scanJobId } = parsed.data;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const access = await requireProjectApiAccess(supabase, user?.id, projectId);
    if (!access.ok) return access.response;

    const admin = createAdminClient();
    const result = await cancelProductionReviewByScanJob(admin, {
      organizationId: access.project.organization_id,
      projectId,
      scanJobId,
      cancelledByUserId: access.userId,
    });

    return NextResponse.json({
      ok: true,
      cancelled: result.cancelled,
      alreadyCancelled: result.idempotent,
      status: result.status,
      scanJobId: result.scanJobId,
      scanId: result.reviewId,
    });
  } catch (error) {
    if (error instanceof CancelProductionReviewError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status }
      );
    }
    console.error({
      component: "project-scan-job-cancel-api",
      event: "request_failed",
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { ok: false, error: "Could not cancel review", code: "CANCEL_REQUEST_FAILED" },
      { status: 500 }
    );
  }
}
