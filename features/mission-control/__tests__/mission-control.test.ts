import { describe, expect, it } from "vitest";
import {
  buildMissionControlView,
  mapVerdictDisplay,
} from "@/features/mission-control/lib/build-mission-control-view";
import { parseMissionTeamExecutionFromMetadata } from "@/features/mission-control/lib/parse-team-execution";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";

function minimalVerdict(overrides?: Partial<ProductionVerdictV1>): ProductionVerdictV1 {
  return {
    version: "1.0.0",
    projectId: "p",
    repositoryId: "r",
    scanId: "s",
    commitSha: null,
    status: "not_ready",
    score: 62,
    confidence: "medium",
    headline: "Not ready",
    summary: "Fix issues",
    topPriorities: [
      {
        id: "pr1",
        rank: 1,
        title: "Resolve Attack Campaign #1",
        category: "auth",
        reason: "x",
        severity: "critical",
        confidence: "high",
        estimatedMinutes: 120,
        estimatedTimeLabel: "2 hours",
        projectedScoreImpact: 10,
        affectedFiles: [],
        recommendedAction: "Fix",
        findingIds: [],
      },
    ],
    evaluatedAreas: [],
    generatedAt: new Date().toISOString(),
    methodology: "test",
    limitations: "",
    ...overrides,
  } as ProductionVerdictV1;
}

describe("Mission Control view model", () => {
  it("scenario A: static site profile selects browser only among attack teams", () => {
    const view = buildMissionControlView({
      projectId: "p",
      projectName: "Landing",
      verdict: null,
      scanInProgress: false,
      detectedStack: { static: true },
      feedFromDb: [],
    });
    const attackTeams = view.teams.filter((t) => t.status !== "skipped");
    expect(attackTeams.length).toBe(1);
    expect(attackTeams[0]?.id).toBe("browser");
  });

  it("scenario B: AI SaaS stack selects multiple teams with reasons", () => {
    const view = buildMissionControlView({
      projectId: "p",
      projectName: "AI SaaS",
      verdict: minimalVerdict(),
      scanInProgress: false,
      detectedStack: {
        auth: "clerk",
        api: "rest",
        stripe: true,
        openai: true,
      },
      feedFromDb: [],
    });
    expect(view.teamReasons.length).toBeGreaterThan(4);
    expect(view.teamReasons.some((r) => r.teamId === "llm")).toBe(true);
  });

  it("scenario E: no LLM in stack skips LLM team", () => {
    const view = buildMissionControlView({
      projectId: "p",
      projectName: "API",
      verdict: minimalVerdict(),
      scanInProgress: false,
      detectedStack: { api: "rest", next: true },
      feedFromDb: [],
    });
    const llm = view.teams.find((t) => t.id === "llm");
    expect(llm?.status).toBe("skipped");
  });

  it("maps production verdict to mission display labels", () => {
    expect(mapVerdictDisplay(minimalVerdict({ status: "ready_to_ship" }))).toBe("SAFE TO DEPLOY");
    expect(mapVerdictDisplay(minimalVerdict({ status: "almost_ready" }))).toBe("DEPLOY WITH WARNINGS");
    expect(mapVerdictDisplay(null)).toBe("INSUFFICIENT EVIDENCE");
  });

  it("exposes a single current objective from top priority", () => {
    const view = buildMissionControlView({
      projectId: "p",
      projectName: "x",
      verdict: minimalVerdict(),
      scanInProgress: false,
      feedFromDb: [],
    });
    expect(view.objective.title).toContain("Attack Campaign");
    expect(view.objective.estimatedEffortLabel).toBe("2 hours");
  });

  it("mission header shows progress and phase while scanning", () => {
    const view = buildMissionControlView({
      projectId: "p",
      projectName: "x",
      verdict: null,
      scanInProgress: true,
      sessionProgress: 68,
      sessionPhase: "API Team",
      sessionEtaSeconds: 102,
      feedFromDb: [],
    });
    expect(view.header.progressPercent).toBe(68);
    expect(view.header.statusLabel).toBe("Analyzing");
    expect(view.header.etaLabel).toBe("1m 42s");
  });
});

describe("Mission Control sections", () => {
  it("feed lists newest-first when provided from database order", () => {
    const view = buildMissionControlView({
      projectId: "p",
      projectName: "x",
      verdict: null,
      scanInProgress: false,
      feedFromDb: [
        { id: "2", message: "Engineering Plan created.", occurredAt: "2026-01-02T00:00:00Z" },
        { id: "1", message: "Discovery completed.", occurredAt: "2026-01-01T00:00:00Z" },
      ],
    });
    expect(view.feed[0]?.message).toContain("Engineering");
  });

  it("verdict card surfaces deployment recommendation", () => {
    const view = buildMissionControlView({
      projectId: "p",
      projectName: "x",
      verdict: minimalVerdict({ status: "ready_to_ship", score: 90 }),
      scanInProgress: false,
      feedFromDb: [],
    });
    expect(view.verdict.display).toBe("SAFE TO DEPLOY");
    expect(view.verdict.deploymentRecommendation.length).toBeGreaterThan(10);
  });

  it("reflects Business Logic Team execution states from metadata overrides", () => {
    const statuses = ["queued", "running", "completed", "skipped", "failed"] as const;
    for (const status of statuses) {
      const view = buildMissionControlView({
        projectId: "p",
        projectName: "Billing SaaS",
        verdict: minimalVerdict(),
        scanInProgress: false,
        detectedStack: { stripe: true, subscription: true },
        feedFromDb: [],
        teamExecution: { business_logic: status },
      });
      const bl = view.teams.find((t) => t.id === "business_logic");
      expect(bl?.status).toBe(status);
    }
  });

  it("parses redTeamTeamExecution from scan job metadata shape", () => {
    const parsed = parseMissionTeamExecutionFromMetadata({
      redTeamTeamExecution: {
        business_logic: "running",
        api: "completed",
        invalid: "nope",
      },
    });
    expect(parsed?.business_logic).toBe("running");
    expect(parsed?.api).toBe("completed");
    expect(parsed?.browser).toBeUndefined();
  });
});
