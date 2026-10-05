import { describe, expect, it } from "vitest";
import {
  firstNameFromUser,
  greetingKeyForHour,
  pickPrimaryDashboardFocus,
} from "@/lib/dashboard/pick-primary-project";
import type { ProjectBrainSummary } from "@/brain";

describe("pickPrimaryDashboardFocus", () => {
  const projects: ProjectBrainSummary[] = [
    {
      projectId: "a",
      projectName: "Alpha",
      productionReady: 80,
      scoreDelta: null,
      projectedScore: null,
      blockersCount: 0,
      healthStatus: null,
      status: "ready_to_ship",
      lastReviewedCommit: null,
      generatedAt: null,
      affirmsDeploy: true,
    },
    {
      projectId: "b",
      projectName: "Beta",
      productionReady: 40,
      scoreDelta: null,
      projectedScore: null,
      blockersCount: 2,
      healthStatus: null,
      status: "not_ready",
      lastReviewedCommit: null,
      generatedAt: null,
    },
  ];

  it("prioritizes the least ready project", () => {
    const focus = pickPrimaryDashboardFocus(projects, new Map());
    expect(focus?.primary.projectId).toBe("b");
    expect(focus?.orgCanDeploy).toBe(false);
  });

  it("marks org deployable only when every project is ready AND its verdict passes the evidence gate", () => {
    const focus = pickPrimaryDashboardFocus([projects[0]], new Map());
    expect(focus?.orgCanDeploy).toBe(true);
  });

  it("a ready_to_ship status without the evidence to affirm it (low confidence / incomplete coverage) is never 'yes, deploy'", () => {
    expect(pickPrimaryDashboardFocus([{ ...projects[0], affirmsDeploy: false }], new Map())?.orgCanDeploy).toBe(false);
    // A summary without the flag (legacy / unknown evidence) is not affirmed either.
    const { affirmsDeploy: _omit, ...unflagged } = projects[0];
    expect(pickPrimaryDashboardFocus([unflagged], new Map())?.orgCanDeploy).toBe(false);
  });

  it("one unaffirmed project among ready ones keeps the whole portfolio from saying yes", () => {
    const ready2 = { ...projects[0], projectId: "c", projectName: "Gamma" };
    expect(pickPrimaryDashboardFocus([projects[0], { ...ready2, affirmsDeploy: false }], new Map())?.orgCanDeploy).toBe(false);
    expect(pickPrimaryDashboardFocus([projects[0], ready2], new Map())?.orgCanDeploy).toBe(true);
  });
});

describe("greeting helpers", () => {
  it("picks morning greeting before noon", () => {
    expect(greetingKeyForHour(9)).toBe("greetingMorning");
  });

  it("extracts first name from profile", () => {
    expect(firstNameFromUser({ fullName: "Mohamed Fornah", email: "m@x.com" })).toBe("Mohamed");
  });
});
