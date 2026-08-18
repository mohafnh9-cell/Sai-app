import { inngest } from "@/inngest/client";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { listDailyEligibleProjects, runDailyProtectionReview } from "@/server/continuous-protection/daily-review";

export const cpDailyBatchFunction = inngest.createFunction(
  { id: "cp-daily-batch", name: "Continuous protection daily batch" },
  { cron: "0 6 * * *" },
  async ({ step }) => {
    const admin = createAdminClient();
    const projects = await step.run("list-eligible-projects", () =>
      listDailyEligibleProjects(admin)
    );

    if (!projects.length) {
      return { enqueued: 0 };
    }

    await step.sendEvent(
      "fan-out-daily",
      projects.map((p) => ({
        name: "cp/daily.project" as const,
        data: { projectId: p.projectId, organizationId: p.organizationId },
      }))
    );

    return { enqueued: projects.length };
  }
);

export const cpDailyProjectFunction = inngest.createFunction(
  {
    id: "cp-daily-project",
    name: "Continuous protection daily review",
    retries: 2,
    concurrency: { limit: 5 },
  },
  { event: "cp/daily.project" },
  async ({ event, step }) => {
    const admin = createAdminClient();
    const result = await step.run("daily-review", () =>
      runDailyProtectionReview(admin, event.data.projectId)
    );
    return result;
  }
);
