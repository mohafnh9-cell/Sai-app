import { randomUUID } from "node:crypto";
import type { UniversalEngineeringPlan, VerificationEngineeringPlan } from "../uee.types";

export function buildVerificationEngineeringPlan(
  plan: UniversalEngineeringPlan
): VerificationEngineeringPlan {
  return {
    planId: randomUUID(),
    parentPlanId: plan.planId,
    summary: `Verify remediation for campaign ${plan.campaign.campaignId}`,
    securityVerification: [
      "Confirm each root cause is addressed by at least one implementation step.",
      "Validate authorization and authentication boundaries on affected routes.",
    ],
    replayValidation: [
      "Re-run all linked replay plans; previously successful attacks must fail.",
      "Document observed HTTP/status outcomes for each replay step.",
    ],
    regressionTesting: plan.regressionTests.map((t) => `${t.title}: ${t.description}`),
    performanceValidation: [
      "Ensure middleware and policy changes do not add unacceptable latency to hot paths.",
    ],
    architectureValidation: [
      "Confirm no unintended public API contract changes.",
      "Confirm architecture notes and constraints were respected.",
    ],
    definitionOfDone: [
      "All verification sections satisfied",
      "Replay status passed",
      "No new critical findings in targeted regression suite",
    ],
  };
}
