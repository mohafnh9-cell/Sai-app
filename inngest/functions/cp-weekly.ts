import { inngest } from "@/inngest/client";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { listWeeklyEligibleProjects, runWeeklyProtectionReview } from "@/server/continuous-protection/weekly-review";

export const cpWeeklyBatchFunction = inngest.createFunction(
  { id: "cp-weekly-batch", name: "Continuous protection weekly batch" },
  { cron: "0 8 * * 1" },
  async ({ step }) => {
    const admin = createAdminClient();
    const projects = await step.run("list-eligible-projects", () =>
      listWeeklyEligibleProjects(admin)
    );

    if (!projects.length) {
      return { enqueued: 0 };
    }

    await step.sendEvent(
      "fan-out-weekly",
      projects.map((p) => ({
        name: "cp/weekly.project" as const,
        data: { projectId: p.projectId, organizationId: p.organizationId },
      }))
    );

    return { enqueued: projects.length };
  }
);

export const cpWeeklyProjectFunction = inngest.createFunction(
  {
    id: "cp-weekly-project",
    name: "Continuous protection weekly review",
    retries: 2,
    concurrency: { limit: 5 },
  },
  { event: "cp/weekly.project" },
  async ({ event, step }) => {
    const admin = createAdminClient();
    const result = await step.run("weekly-review", () =>
      runWeeklyProtectionReview(admin, event.data.projectId)
    );
    return result;
  }
);
