import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getScanSchedulerMode } from "@/lib/env/scan-scheduler";
import { buildJobsHealthSummary } from "@/server/observability/health-summary";
import { getMetricCounters } from "@/server/observability/metrics";
import { getOperationTimingSummaries } from "@/server/observability/operation-timing";
import { listFeatureFlags } from "@/server/feature-flags";
import { isSecurityWorkerEnabled } from "@/server/security-jobs/worker-config";

export type ReadinessCheck = {
  name: string;
  status: "ok" | "degraded" | "down";
  detail?: string;
};

export type ProductionReadinessSummary = {
  status: "ready" | "degraded" | "not_ready";
  checks: ReadinessCheck[];
  jobs: Awaited<ReturnType<typeof buildJobsHealthSummary>>;
  timings: ReturnType<typeof getOperationTimingSummaries>;
  metrics: ReturnType<typeof getMetricCounters>;
  featureFlags: ReturnType<typeof listFeatureFlags>;
  generatedAt: string;
};

export async function buildProductionReadinessSummary(
  admin: SupabaseClient
): Promise<ProductionReadinessSummary> {
  const checks: ReadinessCheck[] = [];

  const dbStart = Date.now();
  const { error: dbError } = await admin.from("projects").select("id").limit(1);
  checks.push({
    name: "database",
    status: dbError ? "down" : "ok",
    detail: dbError ? dbError.message : `ping ${Date.now() - dbStart}ms`,
  });

  checks.push({
    name: "queue_scheduler",
    status: getScanSchedulerMode() === "inngest" || getScanSchedulerMode() === "inline" ? "ok" : "degraded",
    detail: getScanSchedulerMode(),
  });

  checks.push({
    name: "github_webhook_secret",
    status: process.env.GITHUB_WEBHOOK_SECRET?.trim() ? "ok" : "degraded",
    detail: process.env.GITHUB_WEBHOOK_SECRET?.trim() ? "configured" : "missing",
  });

  checks.push({
    name: "internal_ops_token",
    status: process.env.INTERNAL_OPS_TOKEN?.trim() ? "ok" : "degraded",
    detail: process.env.INTERNAL_OPS_TOKEN?.trim() ? "configured" : "missing",
  });

  checks.push({
    name: "supabase_service_role",
    status: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ? "ok" : "down",
  });

  // Phase 38.7 verification: reports only the derived ENABLED/DISABLED
  // state from the running process's own isSecurityWorkerEnabled() check --
  // never the raw env var value -- so this endpoint (already internal-ops-
  // token gated) can confirm what this specific deployment actually has
  // wired, independent of whether the Vercel dashboard/CLI can read the var
  // back (e.g. when it's marked Sensitive).
  checks.push({
    name: "security_worker_enabled",
    status: isSecurityWorkerEnabled() ? "ok" : "degraded",
    detail: isSecurityWorkerEnabled() ? "ENABLED" : "DISABLED",
  });

  const jobs = await buildJobsHealthSummary(admin);
  if (jobs.stuckJobs > 0) {
    checks.push({ name: "background_workers", status: "degraded", detail: `${jobs.stuckJobs} stuck jobs` });
  } else {
    checks.push({ name: "background_workers", status: "ok" });
  }

  const down = checks.some((c) => c.status === "down");
  const degraded = checks.some((c) => c.status === "degraded");

  return {
    status: down ? "not_ready" : degraded ? "degraded" : "ready",
    checks,
    jobs,
    timings: getOperationTimingSummaries(),
    metrics: getMetricCounters(),
    featureFlags: listFeatureFlags(),
    generatedAt: new Date().toISOString(),
  };
}
