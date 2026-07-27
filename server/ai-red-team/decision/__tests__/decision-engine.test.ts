import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createSecurityDecisionEngine,
  evaluateCoverage,
  evaluateDeploymentGate,
  applyAcceptedRisks,
  buildPrimaryRecommendation,
  recordDecisionHistory,
  createDefaultPolicyRegistry,
  mapDecisionToDeploymentVerdict,
  applySecurityDecisionToProductionVerdict,
  mapSecurityDeploymentToMcpRecommendation,
} from "../index";
import { runSecurityIntelligence } from "../../intelligence/engine";
import type { AttackFinding, AttackResult } from "../../types";
import type { DiscoveryReport } from "../../discovery/types";
import type { DecisionContext } from "../decision-context";
import { confirmedDeployBlockerPolicy } from "../policies/default-policies";

function discoveryFixture(): DiscoveryReport {
  return {
    reportId: "disc-1",
    projectId: "p1",
    organizationId: "o1",
    commitSha: "abc123",
    generatedAt: new Date().toISOString(),
    durationMs: 10,
    projectSummary: "Test",
    detectedTechnologies: [],
    authenticationProviders: [],
    database: [],
    payments: [{ id: "stripe", name: "Stripe", category: "payments", confidence: 0.9, evidence: [] }],
    aiProviders: [],
    infrastructure: [],
    deployment: [],
    storage: [],
    packageManagers: [],
    potentialAttackSurface: [
      { area: "authentication", label: "Auth", rationale: "x", confidence: 0.8 },
      { area: "admin_area", label: "Admin", rationale: "x", confidence: 0.7 },
    ],
    technologyGraph: { nodes: [], edges: [] },
    confidenceScore: 0.8,
    cached: false,
  };
}

function obsFindings(): AttackFinding[] {
  return [
    {
      id: "f1",
      title: "Sensitive session data in localStorage",
      description: "session",
      domain: "browser",
      severity: "high",
      confidence: 0.85,
      evidenceIds: [],
      metadata: {
        team: "browser",
        route: "/dashboard",
        correlationKeys: ["localstorage-auth"],
        safeFixEligible: true,
      },
    },
    {
      id: "f2",
      title: "Missing Content-Security-Policy header",
      description: "csp",
      domain: "browser",
      severity: "medium",
      confidence: 0.75,
      evidenceIds: [],
      metadata: {
        team: "browser",
        route: "/",
        correlationKeys: ["localstorage-auth"],
      },
    },
  ];
}

function browserResult(): AttackResult {
  return {
    agentId: "surface.browser",
    agentName: "Browser Team",
    domain: "browser",
    status: "completed",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 50,
    findings: obsFindings(),
    evidence: [],
    logs: [],
  };
}

function baseContext(): DecisionContext {
  return {
    projectId: "p1",
    organizationId: "o1",
    commitSha: "abc123",
    deploymentEnvironment: "preview",
    safeFixStatus: "none",
    replayStatus: "not_run",
    redTeamRunStatus: "completed",
    evidenceCommitSha: "abc123",
  };
}

describe("Security Decision Engine RT5", () => {
  it("evaluates modular policies independently", () => {
    const intelligence = runSecurityIntelligence({
      discovery: discoveryFixture(),
      results: [browserResult()],
    });
    const result = confirmedDeployBlockerPolicy.evaluate({
      intelligence,
      context: baseContext(),
    });
    expect(result.triggered).toBe(true);
    expect(result.effect).toBe("BLOCK_DEPLOYMENT");
  });

  it("blocks deployment when replay failed", () => {
    const intelligence = runSecurityIntelligence({
      discovery: discoveryFixture(),
      results: [browserResult()],
    });
    const engine = createSecurityDecisionEngine();
    const report = engine.decide({
      intelligence,
      context: { ...baseContext(), replayStatus: "failed" },
    });
    expect(report.decision.deploymentVerdict).toBe("DO_NOT_DEPLOY");
    expect(report.decision.policiesTriggered).toContain("gate.replay_failed");
  });

  it("returns insufficient evidence when attack run incomplete", () => {
    const intelligence = runSecurityIntelligence({
      discovery: discoveryFixture(),
      results: [],
    });
    const engine = createSecurityDecisionEngine();
    const report = engine.decide({
      intelligence,
      context: { ...baseContext(), redTeamRunStatus: "running" },
    });
    expect(["INSUFFICIENT_EVIDENCE", "REQUIRES_VERIFICATION"]).toContain(report.decision.decision);
    expect(report.decision.deploymentVerdict).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("computes coverage gaps and score", () => {
    const intelligence = runSecurityIntelligence({
      discovery: discoveryFixture(),
      results: [browserResult()],
    });
    const coverage = evaluateCoverage({ intelligence, context: baseContext() });
    expect(coverage.score).toBeGreaterThan(0);
    expect(coverage.gaps.length).toBeGreaterThan(0);
  });

  it("honors accepted risk for blockers", () => {
    const intelligence = runSecurityIntelligence({
      discovery: discoveryFixture(),
      results: [browserResult()],
    });
    const acceptance = applyAcceptedRisks({
      intelligence,
      acceptedRisks: [
        {
          id: randomUUID(),
          findingId: intelligence.priorities[0]?.findingId ?? "f1",
          owner: "security",
          reason: "preview only",
          expiration: new Date(Date.now() + 86400000).toISOString(),
          approvedBy: "lead",
          reviewDate: new Date().toISOString(),
        },
      ],
    });
    const gate = evaluateDeploymentGate({
      policyResults: createDefaultPolicyRegistry()
        .list()
        .map((p) => p.evaluate({ intelligence, context: baseContext() })),
      coverage: evaluateCoverage({ intelligence, context: baseContext() }),
      riskAcceptance: acceptance,
      hasFindings: true,
      minCoverageScore: 0.35,
    });
    expect(gate.decision).not.toBe("APPROVE_DEPLOYMENT");
  });

  it("produces founder and engineer explanations", () => {
    const intelligence = runSecurityIntelligence({
      discovery: discoveryFixture(),
      results: [browserResult()],
    });
    const report = createSecurityDecisionEngine().decide({
      intelligence,
      context: baseContext(),
    });
    expect(report.explanation.founder.headline.length).toBeGreaterThan(0);
    expect(report.explanation.engineer.policiesTriggered.length).toBeGreaterThan(0);
  });

  it("maps deployment verdict to production scan status", () => {
    expect(mapDecisionToDeploymentVerdict("BLOCK_DEPLOYMENT")).toBe("DO_NOT_DEPLOY");
    expect(mapSecurityDeploymentToMcpRecommendation("SAFE_TO_DEPLOY")).toBe("SHIP_IT");
  });

  it("records decision history with policy version", () => {
    const entry = recordDecisionHistory({
      projectId: "p1",
      commitSha: "abc",
      decision: "BLOCK_DEPLOYMENT",
      deploymentVerdict: "DO_NOT_DEPLOY",
      confidence: "high",
      reasonSummary: "test",
    });
    expect(entry.policyVersion).toContain("rt5");
  });

  it("integrates intelligence into a block decision with primary recommendation", () => {
    const intelligence = runSecurityIntelligence({
      discovery: discoveryFixture(),
      results: [browserResult()],
    });
    const report = createSecurityDecisionEngine().decide({
      intelligence,
      context: baseContext(),
    });
    expect(report.decision.deploymentVerdict).toBe("DO_NOT_DEPLOY");
    expect(report.decision.primaryRecommendation.length).toBeGreaterThan(0);
    const rec = buildPrimaryRecommendation({
      decision: report.decision.decision,
      intelligence,
      coverage: evaluateCoverage({ intelligence, context: baseContext() }),
    });
    expect(rec.action.kind).toBe("block_deploy");
  });

  it("bridges decision into production verdict shape", () => {
    const intelligence = runSecurityIntelligence({
      discovery: discoveryFixture(),
      results: [browserResult()],
    });
    const decision = createSecurityDecisionEngine().decide({
      intelligence,
      context: baseContext(),
    });
    const merged = applySecurityDecisionToProductionVerdict(
      {
        version: "1.0.0",
        projectId: randomUUID(),
        repositoryId: randomUUID(),
        scanId: randomUUID(),
        commitSha: "abc123",
        branch: "main",
        status: "ready_to_ship",
        score: 90,
        previousScore: null,
        scoreDelta: null,
        projectedScore: 90,
        projectedScoreIsEstimate: false,
        blockersCount: 0,
        criticalBlockersCount: 0,
        highBlockersCount: 0,
        estimatedFixMinutes: 0,
        confidence: "high",
        executiveSummary: "ok",
        topPriorities: [],
        evaluatedAreas: [],
        partiallyEvaluatedAreas: [],
        unevaluatedAreas: [],
        introducedBlockers: 0,
        resolvedBlockers: 0,
        coverageRatio: 1,
        filesAnalyzed: 1,
        findingsCount: 0,
        recommendedAction: "ship",
        methodologyNote: "test",
        generatedAt: new Date().toISOString(),
      },
      decision
    );
    expect(merged.securityDeploymentVerdict).toBe("DO_NOT_DEPLOY");
    expect(merged.status).toBe("not_ready");
  });
});

describe("Browser → Intelligence → Decision integration", () => {
  it("end-to-end pipeline produces deterministic deployment verdict", () => {
    const intelligence = runSecurityIntelligence({
      discovery: discoveryFixture(),
      results: [browserResult()],
    });
    const a = createSecurityDecisionEngine().decide({ intelligence, context: baseContext() });
    const b = createSecurityDecisionEngine().decide({ intelligence, context: baseContext() });
    expect(a.decision.deploymentVerdict).toBe(b.decision.deploymentVerdict);
    expect(a.decision.policiesTriggered.sort()).toEqual(b.decision.policiesTriggered.sort());
  });
});
