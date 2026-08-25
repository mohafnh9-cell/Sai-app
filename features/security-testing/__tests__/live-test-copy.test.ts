import { describe, expect, it } from "vitest";
import type { AttackCenterCampaignView } from "@/features/attack-simulation/types";
import { deriveLiveTestDisplay, deriveLiveTestPhase } from "../lib/live-test-copy";
import { namespaceTranslator } from "@/lib/i18n/review-progress";

const t = namespaceTranslator("en", "securityTest");

function campaignView(
  overrides: Partial<AttackCenterCampaignView> & {
    executions?: AttackCenterCampaignView["executions"];
    campaign?: Partial<AttackCenterCampaignView["campaign"]>;
  } = {}
): AttackCenterCampaignView {
  return {
    kind: "campaign",
    projectId: "project-1",
    campaign: {
      id: "camp-1",
      status: "running",
      commitSha: "abc1234567890",
      runtimeMode: "mock",
      progressPercent: 100,
      estimatedRemainingMs: 0,
      totalScenarios: 1,
      totalExecutions: 4,
      completedExecutions: 0,
      confirmedFindings: 0,
      blockedExecutions: 0,
      updatedAt: "2026-07-30T12:00:00.000Z",
      ...overrides.campaign,
    },
    executions: overrides.executions ?? [],
    feed: [],
  };
}

describe("live-test-copy", () => {
  it("uses honest progress from execution statuses instead of stale campaign percent", () => {
    const view = campaignView({
      executions: [
        {
          id: "e1",
          scenarioId: "s1",
          scenarioTitle: "IDOR",
          adapterId: "idor-cross-tenant",
          status: "fix_ready",
          progressPercent: 100,
          estimatedRemainingMs: 0,
          currentStepTitle: null,
          findingId: "finding-1",
        },
      ],
    });

    const display = deriveLiveTestDisplay(view, t);
    expect(display.progressPercent).toBe(25);
    expect(display.testsDone).toBe(1);
    expect(display.primaryAction?.label).toBe("Fix with AI");
    expect(display.primaryAction?.findingId).toBe("finding-1");
  });

  it("advances wizard phase to fix_ready when an execution is fix_ready", () => {
    const view = campaignView({
      executions: [
        {
          id: "e1",
          scenarioId: "s1",
          scenarioTitle: "IDOR",
          adapterId: "idor-cross-tenant",
          status: "fix_ready",
          progressPercent: 100,
          estimatedRemainingMs: 0,
          currentStepTitle: null,
          findingId: "finding-1",
        },
      ],
    });

    expect(deriveLiveTestPhase(view)).toBe("fix_ready");
  });
});
