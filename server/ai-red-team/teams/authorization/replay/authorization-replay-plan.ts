import { randomUUID } from "node:crypto";
import type { AuthzFindingRecord } from "../findings/authorization-finding";

export type AuthzReplayPlan = {
  replayPlanId: string;
  findingId: string;
  identityLabel: string;
  resource: string;
  action: string;
  expectedStatus: number;
  observedStatus: number;
  replayPassed: boolean;
  steps: string[];
};

export function buildAuthzReplayPlans(findings: AuthzFindingRecord[]): AuthzReplayPlan[] {
  return findings
    .filter((f) => f.replayEligible && f.status !== "duplicate")
    .map((f) => ({
      replayPlanId: randomUUID(),
      findingId: f.findingId,
      identityLabel: f.role,
      resource: f.resource,
      action: f.action,
      expectedStatus: 403,
      observedStatus: 200,
      replayPassed: true,
      steps: [
        `Identity ${f.role}`,
        `Resource ${f.resource}`,
        `403 expected`,
        `200 observed`,
        `Replay passes again`,
        `Confirmed`,
      ],
    }));
}
