import { NextResponse } from "next/server";
import { assertInternalOpsAuthorized } from "@/lib/auth/internal-ops";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { buildReviewExecutionDiagnostic } from "@/server/jobs/scan-execution/execution-diagnostic";
import { toFounderErrorResponse } from "@/server/errors";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ reviewId: string }> }
) {
  const unauthorized = assertInternalOpsAuthorized(request);
  if (unauthorized) return unauthorized;

  try {
    const { reviewId } = await context.params;
    const admin = createAdminClient();
    const diagnostic = await buildReviewExecutionDiagnostic(admin, reviewId);
    if (!diagnostic) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }
    return NextResponse.json(diagnostic);
  } catch (error) {
    const safe = toFounderErrorResponse(error);
    return NextResponse.json(safe, { status: 500 });
  }
}
