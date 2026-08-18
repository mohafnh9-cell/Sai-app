import { inngest } from "@/inngest/client";
import { INNGEST_EVENTS } from "@/inngest/events";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { processWebhookJob } from "@/server/jobs/schedule-scan";
import { markScanJobFailed } from "@/server/jobs/scan-job-store";
import { scanJobIdFromInngestFailure } from "@/inngest/failure-scan-job-id";

export const processGitHubWebhookFunction = inngest.createFunction(
  {
    id: "github-webhook-process",
    name: "Process GitHub webhook delivery",
    retries: 3,
    concurrency: { limit: 5 },
    onFailure: async ({ event, error }) => {
      const scanJobId = scanJobIdFromInngestFailure(event);
      if (!scanJobId) return;
      const admin = createAdminClient();
      await markScanJobFailed(admin, scanJobId, {
        failureCode: error.message.includes("timeout")
          ? "SCAN_JOB_TIMEOUT"
          : "INNGEST_FUNCTION_FAILED",
        failureMessage: error.message,
      }).catch(() => undefined);
    },
  },
  { event: INNGEST_EVENTS.GITHUB_WEBHOOK_PROCESS },
  async ({ event }) => {
    const admin = createAdminClient();
    await processWebhookJob(admin, event.data);
    return { scanJobId: event.data.scanJobId };
  }
);
