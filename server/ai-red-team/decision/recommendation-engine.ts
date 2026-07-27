import { randomUUID } from "node:crypto";
import type { SecurityDecisionAction, SecurityDecisionType } from "./decision-model";
import type { SecurityIntelligenceReport } from "../intelligence/models";
import type { CoverageAssessment } from "./coverage-engine";

export type PrimaryRecommendation = {
  label: string;
  action: SecurityDecisionAction;
};

export function buildPrimaryRecommendation(input: {
  decision: SecurityDecisionType;
  intelligence: SecurityIntelligenceReport;
  coverage: CoverageAssessment;
}): PrimaryRecommendation {
  if (input.decision === "BLOCK_DEPLOYMENT") {
    const top = input.intelligence.priorities[0];
    return {
      label: "Block deployment until top blocker is resolved.",
      action: {
        id: randomUUID(),
        label: "Block deployment",
        kind: "block_deploy",
        required: true,
      },
    };
  }

  if (input.decision === "INSUFFICIENT_EVIDENCE" || input.decision === "REQUIRES_VERIFICATION") {
    const next = input.coverage.recommendedTesting[0];
    if (next?.toLowerCase().includes("replay")) {
      return {
        label: "Run Replay before shipping.",
        action: {
          id: randomUUID(),
          label: "Run Replay",
          kind: "run_replay",
          required: true,
        },
      };
    }
    if (next?.toLowerCase().includes("authentication")) {
      return {
        label: "Run Authentication Team.",
        action: {
          id: randomUUID(),
          label: "Run Authentication Team",
          kind: "run_team",
          required: true,
        },
      };
    }
    return {
      label: next ?? "Complete additional authorized testing.",
      action: {
        id: randomUUID(),
        label: next ?? "Additional testing",
        kind: "run_team",
        required: true,
      },
    };
  }

  if (input.intelligence.groupedSafeFixPlans.length > 0 && input.decision === "APPROVE_WITH_WARNINGS") {
    return {
      label: "Apply grouped Safe Fix for the top attack chain.",
      action: {
        id: randomUUID(),
        label: "Apply Safe Fix",
        kind: "apply_safe_fix",
        required: false,
      },
    };
  }

  return {
    label: "Continue to production with monitoring.",
    action: {
      id: randomUUID(),
      label: "Continue to production",
      kind: "continue",
      required: false,
    },
  };
}

export function buildRequiredActions(recommendation: PrimaryRecommendation): SecurityDecisionAction[] {
  return [recommendation.action];
}
