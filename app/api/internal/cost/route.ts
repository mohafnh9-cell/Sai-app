import { NextResponse } from "next/server";
import { assertInternalOpsAuthorized } from "@/lib/auth/internal-ops";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { buildCostDashboard } from "@/server/production-readiness/cost-dashboard";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = assertInternalOpsAuthorized(request);
  if (unauthorized) return unauthorized;
  const url = new URL(request.url);
  const hours = Number(url.searchParams.get("hours") ?? "24");
  const admin = createAdminClient();
  const dashboard = await buildCostDashboard(admin, Number.isFinite(hours) ? hours : 24);
  return NextResponse.json(dashboard);
}
