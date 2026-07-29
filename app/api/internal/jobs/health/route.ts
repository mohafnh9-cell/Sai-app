import { NextResponse } from "next/server";
import { assertInternalOpsAuthorized } from "@/lib/auth/internal-ops";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { buildJobsHealthSummary } from "@/server/observability/health-summary";
import {
  evaluateOperationalAlerts,
  emitOperationalAlerts,
  fetchAlertWindowMetrics,
} from "@/server/observability/alert-routing";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = assertInternalOpsAuthorized(request);
  if (unauthorized) return unauthorized;

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
