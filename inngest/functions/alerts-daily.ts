import { inngest } from "@/inngest/client";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import {
  evaluateProjectAlerts,
  listAlertEligibleProjects,
} from "@/server/security-alerts/evaluate-project";

export const alertsDailyBatchFunction = inngest.createFunction(
  { id: "alerts-daily-batch", name: "Security alerts daily evaluation batch" },
  { cron: "30 7 * * *" },
  async ({ step }) => {
    const admin = createAdminClient();
    const projects = await step.run("list-eligible", () => listAlertEligibleProjects(admin));
    if (!projects.length) return { enqueued: 0 };

    await step.sendEvent(
      "fan-out-alerts",
      projects.map((p) => ({
        name: "alerts/project.evaluate" as const,
        data: { projectId: p.projectId, organizationId: p.organizationId },
      }))
    );
    return { enqueued: projects.length };
  }
);

export const alertsProjectEvaluateFunction = inngest.createFunction(
  {
    id: "alerts-project-evaluate",
    name: "Security alerts project evaluation",
    retries: 2,
    concurrency: { limit: 5 },
  },
  { event: "alerts/project.evaluate" },
  async ({ event, step }) => {
    const admin = createAdminClient();
    return step.run("evaluate", () => evaluateProjectAlerts(admin, event.data.projectId));
  }
);
