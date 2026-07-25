import { Inngest } from "inngest";
import type { ScanRunPayload } from "@/server/jobs/types";

type Events = {
  "scan/run": { data: ScanRunPayload };
  "github/webhook.process": { data: { scanJobId: string } };
  "cp/daily.project": { data: { projectId: string; organizationId: string } };
  "cp/weekly.project": { data: { projectId: string; organizationId: string } };
  "alerts/project.evaluate": { data: { projectId: string; organizationId: string } };
  "reports/weekly.project": { data: { projectId: string; organizationId: string } };
  "reports/monthly.project": { data: { projectId: string; organizationId: string } };
};

export const inngest = new Inngest({
  id: "sequrai",
  eventKey: process.env.INNGEST_EVENT_KEY,
});

export type { Events };
