import { inngest } from "@/inngest/client";
import { createAdminClient } from "@/server/security-scanner/admin-client";
import { runScanJobRecovery } from "@/server/jobs/recovery";

export const scanJobRecoveryFunction = inngest.createFunction(
  {
    id: "scan-job-recovery",
    name: "Recover stuck scan jobs",
  },
  { cron: "*/5 * * * *" },
  async () => {
    const admin = createAdminClient();
    const summary = await runScanJobRecovery(admin);
    return summary;
  }
);
