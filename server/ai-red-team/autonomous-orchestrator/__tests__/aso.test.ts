import { describe, expect, it } from "vitest";
import type { DiscoveryReport } from "../../discovery/types";
import {
  analyzeDiscoverySignals,
  createAutonomousSecurityOrchestrator,
  scheduleOrchestrator,
  staticSiteBrowserOnly,
} from "../index";

function discovery(overrides?: Partial<DiscoveryReport>): DiscoveryReport {
  return {
    reportId: "d",
    projectId: "p",
    organizationId: "o",
    commitSha: "abc",
    generatedAt: new Date().toISOString(),
    durationMs: 1,
    projectSummary: overrides?.projectSummary ?? "",
    detectedTechnologies: overrides?.detectedTechnologies ?? [],
    authenticationProviders: overrides?.authenticationProviders ?? [],
    database: [],
    payments: overrides?.payments ?? [],
    aiProviders: overrides?.aiProviders ?? [],
    infrastructure: [],
    deployment: [],
    storage: [],
    packageManagers: [],
    potentialAttackSurface: overrides?.potentialAttackSurface ?? [],
    technologyGraph: { nodes: [], edges: [] },
    confidenceScore: 0.8,
    cached: false,
    ...overrides,
  };
}

describe("Autonomous Security Orchestrator RT13", () => {
  it("scenario A: static site selects all attack teams by default", () => {
    const disc = discovery({
      projectSummary: "Marketing landing page",
      potentialAttackSurface: [{ area: "marketing", label: "Landing", rationale: "x", confidence: 0.9 }],
    });
    const signals = analyzeDiscoverySignals(disc);
    expect(signals.isStaticSite).toBe(true);
    const plan = scheduleOrchestrator({
      requestId: "r",
      organizationId: "o",
      projectId: "p",
      discovery: disc,
    });
    expect(staticSiteBrowserOnly(plan.teamSelections)).toBe(false);
    expect(plan.selectedTeams).toEqual(
      expect.arrayContaining([
        "browser",
        "authentication",
        "api",
        "authorization",
        "business_logic",
        "llm",
        "adversarial",
      ])
    );
    expect(plan.waves.every((w) => !w.parallel || w.nodeIds.length === 1)).toBe(true);
  });

  it("scenario B: AI SaaS selects required teams", () => {
    const disc = discovery({
      projectSummary: "AI SaaS on Next.js",
      detectedTechnologies: [
        { id: "1", name: "Next.js", category: "framework", confidence: 0.9, evidence: [] },
      ],
      authenticationProviders: [{ id: "a", name: "Clerk", category: "auth", confidence: 0.9, evidence: [] }],
      aiProviders: [{ id: "o", name: "OpenAI", category: "ai", confidence: 0.9, evidence: [] }],
      payments: [{ id: "s", name: "Stripe", category: "payments", confidence: 0.9, evidence: [] }],
      potentialAttackSurface: [
        { area: "rest_api", label: "API", rationale: "x", confidence: 0.9 },
        { area: "authorization", label: "RBAC", rationale: "x", confidence: 0.9 },
      ],
    });
    const plan = scheduleOrchestrator({
      requestId: "r",
      organizationId: "o",
      projectId: "p",
      discovery: disc,
      parallelExecutionEnabled: true,
    });
    expect(plan.selectedTeams).toContain("browser");
    expect(plan.selectedTeams).toContain("authentication");
    expect(plan.selectedTeams).toContain("api");
    expect(plan.selectedTeams).toContain("authorization");
    expect(plan.selectedTeams).toContain("business_logic");
    expect(plan.selectedTeams).toContain("llm");
    expect(plan.selectedTeams).toContain("adversarial");
    expect(plan.waves.some((w) => w.parallel && w.nodeIds.length > 1)).toBe(true);
  });

  it("scenario C: plan includes remaining teams when one team would fail at runtime", () => {
    const plan = scheduleOrchestrator({
      requestId: "r",
      organizationId: "o",
      projectId: "p",
      discovery: discovery({
        detectedTechnologies: [{ id: "1", name: "Next.js", category: "framework", confidence: 0.9, evidence: [] }],
        potentialAttackSurface: [{ area: "rest_api", label: "API", rationale: "x", confidence: 0.9 }],
      }),
    });
    expect(plan.selectedTeams.filter((t) => t !== "intelligence").length).toBeGreaterThan(2);
  });

  it("scenario D: failed replay escalates replay and engineering strategy", () => {
    const plan = scheduleOrchestrator({
      requestId: "r",
      organizationId: "o",
      projectId: "p",
      discovery: discovery(),
      previousReplayFailed: true,
    });
    expect(plan.replayStrategy).toBe("full");
    expect(plan.engineeringStrategy).toBe("best_practice");
  });

  it("scenario E: adaptive mode can skip LLM team when no AI stack", () => {
    const plan = scheduleOrchestrator({
      requestId: "r",
      organizationId: "o",
      projectId: "p",
      discovery: discovery({
        detectedTechnologies: [{ id: "1", name: "Next.js", category: "framework", confidence: 0.9, evidence: [] }],
        authenticationProviders: [{ id: "a", name: "Auth.js", category: "auth", confidence: 0.8, evidence: [] }],
        potentialAttackSurface: [{ area: "rest_api", label: "API", rationale: "x", confidence: 0.9 }],
      }),
      adaptiveTeamSelection: true,
    });
    const llmSkip = plan.skippedTeams.find((s) => s.teamId === "llm");
    expect(llmSkip).toBeDefined();
    expect(plan.selectedTeams).not.toContain("llm");
  });

  it("planning completes under 1 second and scheduling under 100ms", () => {
    const start = Date.now();
    const decision = createAutonomousSecurityOrchestrator().plan({
      requestId: "r",
      organizationId: "o",
      projectId: "p",
      discovery: discovery({
        aiProviders: [{ id: "1", name: "OpenAI", category: "ai", confidence: 0.9, evidence: [] }],
        potentialAttackSurface: [{ area: "rest_api", label: "API", rationale: "x", confidence: 0.9 }],
      }),
    });
    expect(Date.now() - start).toBeLessThan(1000);
    expect(decision.executionPlan.schedulingMs).toBeLessThan(100);
  });
});
