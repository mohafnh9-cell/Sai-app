import { randomUUID } from "node:crypto";
import type { ApiFindingRecord } from "../findings/api-finding";

export type ApiReplayPlan = {
  id: string;
  findingId: string;
  title: string;
  steps: Array<{ method: string; path: string; expectStatus?: number }>;
  replayEligible: boolean;
};

export function buildApiReplayPlans(findings: ApiFindingRecord[]): ApiReplayPlan[] {
  const plans: ApiReplayPlan[] = [];
  for (const finding of findings) {
    if (!finding.replayEligible || finding.status === "duplicate") continue;
    plans.push({
      id: randomUUID(),
      findingId: finding.findingId,
      title: `Replay: ${finding.title}`,
      steps: [{ method: finding.method, path: finding.route, expectStatus: finding.category === "error_disclosure" ? 500 : 200 }],
      replayEligible: true,
    });
  }
  return plans;
}
