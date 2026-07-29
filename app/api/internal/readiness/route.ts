import { NextResponse } from "next/server";
import { assertInternalOpsAuthorized } from "@/lib/auth/internal-ops";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { buildProductionReadinessSummary } from "@/server/production-readiness/readiness-summary";
import { toFounderErrorResponse } from "@/server/errors";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = assertInternalOpsAuthorized(request);
  if (unauthorized) return unauthorized;
  try {
    const admin = createAdminClient();
    const summary = await buildProductionReadinessSummary(admin);
    return NextResponse.json(summary);
  } catch (error) {
    const safe = toFounderErrorResponse(error);
    return NextResponse.json(safe, { status: 500 });
  }
}
