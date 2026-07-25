import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isInngestEnabledForOrganization } from "@/lib/env/scan-scheduler";
import { emitOperationalEvent } from "@/server/observability/operational-events";
import {
  findJobsNeedingFinalize,
  findStuckScanJobs,
  getScanJob,
  markScanJobCompleted,
  markScanJobFailed,
  recoverScanJobToQueued,
  type ScanJobRow,
} from "./scan-job-store";
import { executeScanRunJob } from "./run-scan-job";
import { processWebhookJob } from "./schedule-scan";
import type { ScanRunPayload } from "./types";
import { rehydrateWebhookProcessPayload } from "./inngest-payload";
import { buildJobsHealthSummary } from "@/server/observability/health-summary";
import {
  evaluateOperationalAlerts,
  emitOperationalAlerts,
  fetchAlertWindowMetrics,
} from "@/server/observability/alert-routing";

export type RecoverySummary = {
  scanned: number;
  recovered: number;
  finalized: number;
  failed: number;
};

const SCAN_RUN_JOB_TYPES = new Set([
  "manual_scan",
  "mcp_review",
  "webhook_push_scan",
  "webhook_pr_scan",
  "automatic_review",
]);

async function reenqueueScanJob(admin: SupabaseClient, job: ScanJobRow): Promise<boolean> {
  if (!job.scan_id) return false;

  const payload: ScanRunPayload = {
    scanJobId: job.id,
    scanId: job.scan_id,
    organizationId: job.organization_id,
    projectId: job.project_id ?? "",
    userId: (job.metadata.userId as string | undefined) ?? job.organization_id,
    jobType: job.job_type,
    scanType: (job.metadata.scanType as "full" | "incremental" | undefined) ?? undefined,
    branch: (job.metadata.branch as string | undefined) ?? undefined,
    persistMode: job.metadata.persistMode as "full" | "review_only" | undefined,
    finalize: job.metadata.finalize as ScanRunPayload["finalize"],
  };

  if (isInngestEnabledForOrganization(job.organization_id)) {
    const { inngest } = await import("@/inngest/client");
    await inngest.send({ name: "scan/run", data: payload });
    return true;
  }

  await executeScanRunJob(admin, payload);
  return true;
}

export async function runScanJobRecovery(admin: SupabaseClient): Promise<RecoverySummary> {
  const summary: RecoverySummary = { scanned: 0, recovered: 0, finalized: 0, failed: 0 };
  const stuck = await findStuckScanJobs(admin);
  const needsFinalize = await findJobsNeedingFinalize(admin);
  const candidates = [...stuck, ...needsFinalize];
  const seen = new Set<string>();

  for (const job of candidates) {
    if (seen.has(job.id)) continue;
    seen.add(job.id);
    summary.scanned += 1;

    if (job.scan_id) {
      const { data: scan } = await admin.from("scans").select("status").eq("id", job.scan_id).maybeSingle();
      if (scan?.status === "completed" && job.status === "running") {
        try {
          if (SCAN_RUN_JOB_TYPES.has(job.job_type)) {
            await executeScanRunJob(admin, {
              scanJobId: job.id,
              scanId: job.scan_id,
              organizationId: job.organization_id,
              projectId: job.project_id ?? "",
              userId: (job.metadata.userId as string | undefined) ?? job.organization_id,
              finalize: job.metadata.finalize as ScanRunPayload["finalize"],
            });
          } else if (job.job_type === "webhook_process") {
            await processWebhookJob(
              admin,
              rehydrateWebhookProcessPayload(job.id, job.metadata)
            );
          } else {
            await markScanJobCompleted(admin, job.id);
          }
          summary.finalized += 1;
          continue;
        } catch {
          summary.failed += 1;
          continue;
        }
      }
    }

    if (job.job_type === "webhook_process") {
      const recovered = await recoverScanJobToQueued(admin, job, { lockedBy: "recovery-cron" });
      if (recovered.recovered && recovered.job) {
        await processWebhookJob(
          admin,
          rehydrateWebhookProcessPayload(recovered.job.id, recovered.job.metadata)
        );
        summary.recovered += 1;
      } else if (!recovered.recovered) {
        const latest = await getScanJob(admin, job.id);
        if (latest?.status === "failed") summary.failed += 1;
      }
      continue;
    }

    if (SCAN_RUN_JOB_TYPES.has(job.job_type)) {
      const recovered = await recoverScanJobToQueued(admin, job, { lockedBy: "recovery-cron" });
      if (recovered.recovered && recovered.job) {
        await reenqueueScanJob(admin, recovered.job);
        summary.recovered += 1;
      } else {
        const latest = await getScanJob(admin, job.id);
        if (latest?.status === "failed") summary.failed += 1;
      }
      continue;
    }

    const failed = await markScanJobFailed(admin, job.id, {
      failureCode: "RECOVERY_UNRECOVERABLE",
      failureMessage: "No recovery handler for job type",
    });
    if (failed.updated) summary.failed += 1;
  }

  await emitOperationalEvent(admin, {
    eventType: "job_recovered",
    metadata: summary,
  });

  const healthSummary = await buildJobsHealthSummary(admin);
  const windowMetrics = await fetchAlertWindowMetrics(admin);
  const alertEvaluation = evaluateOperationalAlerts(healthSummary, windowMetrics);
  await emitOperationalAlerts(alertEvaluation.alerts);

  return summary;
}
