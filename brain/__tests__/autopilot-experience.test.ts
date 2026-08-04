import { describe, expect, it } from "vitest";
import {
  buildAutopilotDashboardView,
  buildAutopilotProjectView,
  deriveAutopilotState,
  isApproachingProduction,
} from "@/brain/autopilot-experience";
import type { ProductionIntelligence } from "@/brain/production-intelligence/schema";
import { loadNamespace } from "@/lib/i18n/load-messages";

const connectedRepository = {
  display: "connected_waiting" as const,
  connectionStatus: "connected" as const,
  errorCode: null,
  branch: null,
  commitSha: null,
  commitMessage: null,
  pushedAt: null,
  detectedAt: null,
  githubRepositoryId: 123,
};

describe("Block 7.0.4 autopilot states", () => {
  it("returns disabled when autopilot is off", () => {
    expect(
      deriveAutopilotState({
        autopilotEnabled: false,
        repositoryConnected: true,
        repositoryWaitingForChanges: false,
        hasActiveReview: false,
        latestAutomaticReviewStatus: null,
        verdictUpdated: null,
      })
    ).toBe("disabled");
  });

  it("returns waiting for changes when connected without reviews", () => {
    expect(
      deriveAutopilotState({
        autopilotEnabled: true,
        repositoryConnected: true,
        repositoryWaitingForChanges: true,
        hasActiveReview: false,
        latestAutomaticReviewStatus: null,
        verdictUpdated: null,
      })
    ).toBe("waiting_for_changes");
  });

  it("returns reviewing changes when a review is active", () => {
    expect(
      deriveAutopilotState({
        autopilotEnabled: true,
        repositoryConnected: true,
        repositoryWaitingForChanges: false,
        hasActiveReview: true,
        latestAutomaticReviewStatus: "processing",
        verdictUpdated: null,
      })
    ).toBe("reviewing_changes");
  });

  it("returns up to date after a completed automatic review", () => {
    expect(
      deriveAutopilotState({
        autopilotEnabled: true,
        repositoryConnected: true,
        repositoryWaitingForChanges: false,
        hasActiveReview: false,
        latestAutomaticReviewStatus: "completed",
        verdictUpdated: true,
      })
    ).toBe("up_to_date");
  });

  it("returns review failed when latest automatic review failed", () => {
    expect(
      deriveAutopilotState({
        autopilotEnabled: true,
        repositoryConnected: true,
        repositoryWaitingForChanges: false,
        hasActiveReview: false,
        latestAutomaticReviewStatus: "failed",
        verdictUpdated: false,
      })
    ).toBe("review_failed");
  });

  it("returns repository disconnected without a connected repo", () => {
    expect(
      deriveAutopilotState({
        autopilotEnabled: true,
        repositoryConnected: false,
        repositoryWaitingForChanges: false,
        hasActiveReview: false,
        latestAutomaticReviewStatus: null,
        verdictUpdated: null,
      })
    ).toBe("repository_disconnected");
  });
});

describe("Block 7.0.4 autopilot project view", () => {
  it("builds a premium summary from existing services data", () => {
    const view = buildAutopilotProjectView({
      autopilotEnabled: true,
      repositoryStatus: connectedRepository,
      automaticReview: {
        enabled: true,
        reviewType: "automatic",
        status: "completed",
        latestReviewAt: "2026-07-18T01:00:00Z",
        verdictUpdated: true,
        errorCode: null,
      },
      intelligence: {
        version: "1.0.0",
        projectId: "10000000-0000-4000-8000-000000000001",
        currentStatus: "almost_ready",
        currentScore: 72,
        previousScore: 58,
        scoreDelta: 14,
        bestScore: 72,
        currentBlockers: 1,
        momentum: "improving",
        momentumExplanationKey: "momentum.explanationImproving",
        whatChanged: { hasChanges: true, items: [] },
        improvements: [
          {
            id: "score-delta",
            kind: "improvement",
            messageKey: "whatChanged.scoreIncreased",
            params: { points: 14 },
          },
        ],
        regressions: [],
        recommendedAction: {
          type: "fix_blocker",
          titleKey: "recommendedAction.fixPriority",
          descriptionKey: "recommendedAction.fixPriorityDescription",
          priorityTitle: "Protect your admin endpoint",
          estimatedMinutes: 20,
          ctaKey: "recommendedAction.viewReportCta",
        },
        weeklyReview: {
          period7d: { scoreChange: 14, blockersResolved: 1, blockersIntroduced: 0 },
          period30d: { scoreChange: 14, blockersResolved: 1, blockersIntroduced: 0 },
          currentFocusKey: "focus.authentication",
          estimatedMinutesToImprovement: 20,
        },
        insights: [],
        healthSummary: {
          currentVerdict: "almost_ready",
          trend: "improving",
          currentFocusKey: "focus.authentication",
          currentMilestoneKey: null,
          currentBlockers: 1,
          bestScore: 72,
          latestChangeDelta: 14,
        },
        journeySummary: {
          validReviews: 2,
          maturity: "approaching_production",
          trend: "improving",
          scoreChange7d: 14,
          scoreChange30d: 14,
        },
        currentFocusKey: "focus.authentication",
        focusExplanationKey: "focusExplanation.authentication",
        emptyState: null,
      } satisfies ProductionIntelligence,
      hasActiveReview: false,
    });

    expect(view.state).toBe("up_to_date");
    expect(view.scoreDelta).toBe(14);
    expect(view.currentStatus).toBe("almost_ready");
    expect(view.recommendedActionTitle).toBe("Protect your admin endpoint");
    expect(view.closerToProduction).toBe(true);
  });
});

describe("Block 7.0.4 autopilot dashboard", () => {
  it("summarizes monitored and approaching production projects", () => {
    const view = buildAutopilotDashboardView({
      orgAutopilotEnabled: true,
      projects: [
        {
          projectId: "p1",
          projectName: "App",
          autopilotEnabled: true,
          repositoryConnected: true,
          repositoryWaitingForChanges: false,
          hasActiveReview: false,
          latestAutomaticReviewStatus: "completed",
          latestAutomaticReviewAt: "2026-07-18T01:00:00Z",
          verdictUpdated: true,
          currentStatus: "almost_ready",
          scoreDelta: 14,
        },
        {
          projectId: "p2",
          projectName: "API",
          autopilotEnabled: true,
          repositoryConnected: true,
          repositoryWaitingForChanges: true,
          hasActiveReview: false,
          latestAutomaticReviewStatus: null,
          latestAutomaticReviewAt: null,
          verdictUpdated: null,
          currentStatus: null,
          scoreDelta: null,
        },
      ],
    });

    expect(view.monitoredCount).toBe(2);
    expect(view.waitingCount).toBe(1);
    expect(view.approachingProductionCount).toBe(1);
    expect(view.latestAutomaticReviewProjectName).toBe("App");
    expect(isApproachingProduction("almost_ready")).toBe(true);
  });

  it("returns empty dashboard metrics when autopilot is disabled", () => {
    const view = buildAutopilotDashboardView({
      orgAutopilotEnabled: false,
      projects: [],
    });
    expect(view.autopilotEnabled).toBe(false);
    expect(view.monitoredCount).toBe(0);
  });
});

describe("Block 7.0.4 autopilot i18n", () => {
  it("loads autopilotExperience in English and Spanish", () => {
    const en = loadNamespace("en", "autopilotExperience");
    const es = loadNamespace("es", "autopilotExperience");

    expect(en.title).toBe("Production Review");
    expect(es.subtitleReviewed).toContain("revisados");
    expect((en.states as Record<string, string>).up_to_date).toBe("Up to date");
    expect((es.states as Record<string, string>).waiting_for_changes).toContain("Esperando");
    expect((en.settings as Record<string, string>).title).toBe("Production Review");
  });
});
