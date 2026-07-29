import { inngest } from "@/inngest/client";
import { INNGEST_EVENTS } from "@/inngest/events";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { executeScanRunJob } from "@/server/jobs/run-scan-job";
import { markScanJobFailed } from "@/server/jobs/scan-job-store";
import {
  SCAN_JOB_ORG_CONCURRENCY_LIMIT,
  SCAN_JOB_TIMEOUT_MS,
} from "@/server/jobs/types";
import { scanJobIdFromInngestFailure } from "@/inngest/failure-scan-job-id";
import { parseScanRunInngestEvent } from "@/server/jobs/inngest-payload";

async function markScanJobFailureFromInngest(
  scanJobId: string | undefined,
  failureCode: string,
  message: string
) {
  if (!scanJobId) return;
  const admin = createAdminClient();
  await markScanJobFailed(admin, scanJobId, {
    failureCode,
    failureMessage: message,
  }).catch((error) => {
    console.error({
      component: "inngest-scan-run",
      event: "failure_mark_failed",
      scanJobId,
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

export const scanRunFunction = inngest.createFunction(
  {
    id: "scan-run",
    name: "Run security scan job",
    retries: 3,
    timeouts: { finish: `${Math.floor(SCAN_JOB_TIMEOUT_MS / 60000)}m` },
    concurrency: {
      limit: SCAN_JOB_ORG_CONCURRENCY_LIMIT,
      key: "event.data.organizationId",
    },
    onFailure: async ({ event, error }) => {
      const scanJobId = scanJobIdFromInngestFailure(event);
      const message = error.message.includes("timeout")
        ? "Scan job exceeded Inngest finish timeout"
        : error.message;
      await markScanJobFailureFromInngest(
        scanJobId,
        error.message.includes("timeout") ? "SCAN_JOB_TIMEOUT" : "INNGEST_FUNCTION_FAILED",
        message
      );
    },
  },
  { event: INNGEST_EVENTS.SCAN_RUN },
  async ({ event, attempt, runId }) => {
    const admin = createAdminClient();
    let payload;
    try {
      payload = parseScanRunInngestEvent(event.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid scan/run payload";
      await markScanJobFailureFromInngest(
        (event.data as { scanJobId?: string })?.scanJobId,
        "INNGEST_PAYLOAD_INVALID",
        message
      );
      throw error;
    }

    console.info({
      component: "inngest-scan-run",
      event: "scan_job_worker_started",
      scanJobId: payload.scanJobId,
      scanId: payload.scanId,
      inngestRunId: runId,
      attempt,
      correlationId: payload.correlationId ?? null,
    });

    await executeScanRunJob(admin, payload, {
      inngestRunId: runId,
      attempt,
    });
    return { scanJobId: payload.scanJobId, scanId: payload.scanId };
  }
);
