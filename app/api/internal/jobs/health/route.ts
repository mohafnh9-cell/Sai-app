import { NextResponse } from "next/server";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { buildJobsHealthSummary } from "@/server/observability/health-summary";
import {
  evaluateOperationalAlerts,
  emitOperationalAlerts,
  fetchAlertWindowMetrics,
} from "@/server/observability/alert-routing";

export const runtime = "nodejs";

function authorized(request: Request): boolean {
  const expected = process.env.INTERNAL_OPS_TOKEN?.trim();
  if (!expected) return false;
  const provided = request.headers.get("x-sequrai-ops-token");
  return provided === expected;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const [summary, windowMetrics] = await Promise.all([
      buildJobsHealthSummary(admin),
      fetchAlertWindowMetrics(admin),
    ]);
    const alertEvaluation = evaluateOperationalAlerts(summary, windowMetrics);
    await emitOperationalAlerts(alertEvaluation.alerts);
    return NextResponse.json(
      {
        ...summary,
        alerts: alertEvaluation,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error({
      component: "ops-health",
      event: "health_unavailable",
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      {
        error: "Could not build jobs health summary",
        message: error instanceof Error ? error.message : "unknown",
      },
      { status: 500 }
    );
  }
}
