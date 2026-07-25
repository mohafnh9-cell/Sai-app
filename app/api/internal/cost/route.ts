import { NextResponse } from "next/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { buildCostDashboard } from "@/server/production-readiness/cost-dashboard";

export const runtime = "nodejs";

function authorized(request: Request): boolean {
  const expected = process.env.INTERNAL_OPS_TOKEN?.trim();
  if (!expected) return false;
  return request.headers.get("x-sequrai-ops-token") === expected;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const hours = Number(url.searchParams.get("hours") ?? "24");
  const admin = createAdminClient();
  const dashboard = await buildCostDashboard(admin, Number.isFinite(hours) ? hours : 24);
  return NextResponse.json(dashboard);
}
