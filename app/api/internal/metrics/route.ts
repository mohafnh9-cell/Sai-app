import { NextResponse } from "next/server";
import { assertInternalOpsAuthorized } from "@/lib/auth/internal-ops";
import { getMetricCounters } from "@/server/observability/metrics";
import { getOperationTimingSummaries } from "@/server/observability/operation-timing";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = assertInternalOpsAuthorized(request);
  if (unauthorized) return unauthorized;
  return NextResponse.json({
    counters: getMetricCounters(),
    operationTimings: getOperationTimingSummaries(),
    generatedAt: new Date().toISOString(),
  });
}
