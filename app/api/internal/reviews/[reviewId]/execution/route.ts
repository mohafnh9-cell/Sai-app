import { NextResponse } from "next/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { buildReviewExecutionDiagnostic } from "@/server/jobs/scan-execution/execution-diagnostic";
import { toFounderErrorResponse } from "@/server/errors";

export const runtime = "nodejs";

function authorized(request: Request): boolean {
  const expected = process.env.INTERNAL_OPS_TOKEN?.trim();
  if (!expected) return false;
  return request.headers.get("x-sequrai-ops-token") === expected;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ reviewId: string }> }
) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
