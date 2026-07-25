import { NextResponse } from "next/server";
import { getMetricCounters } from "@/server/observability/metrics";
import { getOperationTimingSummaries } from "@/server/observability/operation-timing";

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
  return NextResponse.json({
    counters: getMetricCounters(),
    operationTimings: getOperationTimingSummaries(),
    generatedAt: new Date().toISOString(),
  });
}
