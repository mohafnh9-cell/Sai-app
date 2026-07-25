import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { scanRunFunction } from "@/inngest/functions/scan-run";
import { processGitHubWebhookFunction } from "@/inngest/functions/process-github-webhook";
import { scanJobRecoveryFunction } from "@/inngest/functions/scan-job-recovery";
import {
  cpDailyBatchFunction,
  cpDailyProjectFunction,
} from "@/inngest/functions/cp-daily";
import {
  cpWeeklyBatchFunction,
  cpWeeklyProjectFunction,
} from "@/inngest/functions/cp-weekly";
import {
  alertsDailyBatchFunction,
  alertsProjectEvaluateFunction,
} from "@/inngest/functions/alerts-daily";
import {
  reportsMonthlyBatchFunction,
  reportsMonthlyProjectFunction,
  reportsWeeklyBatchFunction,
  reportsWeeklyProjectFunction,
} from "@/inngest/functions/reports-protection";

export const runtime = "nodejs";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    scanRunFunction,
    processGitHubWebhookFunction,
    scanJobRecoveryFunction,
    cpDailyBatchFunction,
    cpDailyProjectFunction,
    cpWeeklyBatchFunction,
    cpWeeklyProjectFunction,
    alertsDailyBatchFunction,
    alertsProjectEvaluateFunction,
    reportsWeeklyBatchFunction,
    reportsWeeklyProjectFunction,
    reportsMonthlyBatchFunction,
    reportsMonthlyProjectFunction,
  ],
  signingKey: process.env.INNGEST_SIGNING_KEY,
});
