import { NextResponse } from "next/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { buildProductionReadinessSummary } from "@/server/production-readiness/readiness-summary";
import { toFounderErrorResponse } from "@/server/errors";

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
  try {
    const admin = createAdminClient();
    const summary = await buildProductionReadinessSummary(admin);
    return NextResponse.json(summary);
  } catch (error) {
    const safe = toFounderErrorResponse(error);
    return NextResponse.json(safe, { status: 500 });
  }
}
