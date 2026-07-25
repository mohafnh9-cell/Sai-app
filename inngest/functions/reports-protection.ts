import { inngest } from "@/inngest/client";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import {
  generateWeeklyProtectionReport,
  listWeeklyReportEligibleProjects,
} from "@/server/protection-reports/generate-weekly";
import {
  generateMonthlyProtectionReport,
  listMonthlyReportEligibleProjects,
} from "@/server/protection-reports/generate-monthly";

export const reportsWeeklyBatchFunction = inngest.createFunction(
  { id: "reports-weekly-batch", name: "Protection reports weekly batch" },
  { cron: "0 9 * * 1" },
  async ({ step }) => {
    const admin = createAdminClient();
    const projects = await step.run("list-eligible", () => listWeeklyReportEligibleProjects(admin));
    if (!projects.length) return { enqueued: 0 };
    await step.sendEvent(
      "fan-out-weekly-reports",
      projects.map((p) => ({
        name: "reports/weekly.project" as const,
        data: { projectId: p.projectId, organizationId: p.organizationId },
      }))
    );
    return { enqueued: projects.length };
  }
);

export const reportsWeeklyProjectFunction = inngest.createFunction(
  { id: "reports-weekly-project", name: "Protection weekly report", retries: 2, concurrency: { limit: 8 } },
  { event: "reports/weekly.project" },
  async ({ event, step }) => {
    const admin = createAdminClient();
    return step.run("generate-weekly", () => generateWeeklyProtectionReport(admin, event.data.projectId));
  }
);

export const reportsMonthlyBatchFunction = inngest.createFunction(
  { id: "reports-monthly-batch", name: "Protection reports monthly batch" },
  { cron: "0 9 1 * *" },
  async ({ step }) => {
    const admin = createAdminClient();
    const projects = await step.run("list-eligible", () => listMonthlyReportEligibleProjects(admin));
    if (!projects.length) return { enqueued: 0 };
    await step.sendEvent(
      "fan-out-monthly-reports",
      projects.map((p) => ({
        name: "reports/monthly.project" as const,
        data: { projectId: p.projectId, organizationId: p.organizationId },
      }))
    );
    return { enqueued: projects.length };
  }
);

export const reportsMonthlyProjectFunction = inngest.createFunction(
  { id: "reports-monthly-project", name: "Protection monthly report", retries: 2, concurrency: { limit: 8 } },
  { event: "reports/monthly.project" },
  async ({ event, step }) => {
    const admin = createAdminClient();
    return step.run("generate-monthly", () => generateMonthlyProtectionReport(admin, event.data.projectId));
  }
);
