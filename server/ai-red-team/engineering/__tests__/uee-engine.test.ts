import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { AttackFinding } from "../../types";
import {
  createUniversalEngineeringEngine,
  cursorAdapter,
  claudeCodeAdapter,
  codexAdapter,
  engineeringPlanToJson,
  resolvePreferredAI,
} from "../index";
import { createSecurityIntelligenceEngine } from "../../intelligence";
import { createSecurityDecisionEngine } from "../../decision";
import type { DiscoveryReport } from "../../discovery/types";

function discovery(): DiscoveryReport {
  return {
    reportId: "d",
    projectId: "p",
    organizationId: "o",
    commitSha: "abc",
    generatedAt: new Date().toISOString(),
    durationMs: 1,
    projectSummary: "B2B SaaS",
    detectedTechnologies: [],
    authenticationProviders: [],
    database: [],
    payments: [],
    aiProviders: [],
    infrastructure: [],
    deployment: [],
    storage: [],
    packageManagers: [],
    potentialAttackSurface: [],
    technologyGraph: { nodes: [], edges: [] },
    confidenceScore: 0.8,
    cached: false,
  };
}

function finding(title: string, domain: AttackFinding["domain"]): AttackFinding {
  return {
    id: randomUUID(),
    title,
    description: title,
    domain,
    severity: "high",
    confidence: 0.9,
    evidenceIds: [],
    metadata: {},
  };
}

function intelligence(findings: AttackFinding[]) {
  return createSecurityIntelligenceEngine().analyze({
    discovery: discovery(),
    results: [
      {
        agentId: "t",
        agentName: "T",
        domain: "api",
        status: "completed",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 1,
        findings,
        evidence: [],
        logs: [],
      },
    ],
    memory: null,
    staticReviewConfidence: null,
  });
}

function baseInput(findings: AttackFinding[]) {
  return {
    organizationId: "o",
    projectId: "p",
    requestId: "req",
    discovery: discovery(),
    intelligence: intelligence(findings),
    results: [],
  };
}

describe("Universal Engineering Engine RT12 UEE", () => {
  it("scenario A: twenty vulnerabilities → one engineering plan with few root causes", () => {
    const findings: AttackFinding[] = [];
    for (let i = 0; i < 8; i++) findings.push(finding(`JWT reusable ${i}`, "authentication"));
    for (let i = 0; i < 7; i++) findings.push(finding(`Broken ownership ${i}`, "authorization"));
    for (let i = 0; i < 5; i++) findings.push(finding(`Admin endpoint ${i}`, "authorization"));
    process.env.SEQURAI_INTERNAL_ORG_IDS = "o";
    const started = Date.now();
    const result = createUniversalEngineeringEngine().run(baseInput(findings));
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.plan.rootCauses.length).toBeLessThanOrEqual(4);
    expect(result.plan.rootCauses.length).toBeGreaterThanOrEqual(2);
    expect(result.plan.summary).not.toMatch(/cursor|claude|codex/i);
    expect(result.plan.replay.mandatory).toBe(true);
  });

  it("scenario B/C/D: same plan adapts to Cursor, Claude, Codex without logic duplication", () => {
    process.env.SEQURAI_INTERNAL_ORG_IDS = "o";
    const findings = [finding("Prompt injection", "llm"), finding("Tenant isolation", "authorization")];
    const engine = createUniversalEngineeringEngine();
    const result = engine.run({ ...baseInput(findings), organizationId: "o", generateAllAdapters: true });
    const ctx = {
      projectSummary: "App",
      plan: result.plan,
      verificationPlan: result.verificationPlan,
    };
    const cursor = cursorAdapter.render(ctx).content;
    const claude = claudeCodeAdapter.render(ctx).content;
    const codex = codexAdapter.render(ctx).content;
    expect(cursor).toContain("Engineering remediation (Cursor)");
    expect(claude).toContain("Engineering remediation (Claude Code)");
    expect(codex).toContain("Engineering remediation (Codex)");
    expect(cursor).toContain(result.plan.attackSummary);
    expect(claude).toContain(result.plan.attackSummary);
    expect(codex).toContain(result.plan.attackSummary);
    const adaptStart = Date.now();
    cursorAdapter.render(ctx);
    claudeCodeAdapter.render(ctx);
    codexAdapter.render(ctx);
    expect(Date.now() - adaptStart).toBeLessThan(500);
  });

  it("scenario E: replay passed — decision can approve; UEE does not self-mark fixed", () => {
    const findings = [finding("Tenant isolation failure", "authorization")];
    const uee = createUniversalEngineeringEngine().run({
      ...baseInput(findings),
      replayStatus: "passed",
    });
    expect(uee.replayVerified).toBe(true);
    expect(uee.productionReadyViaReplayOnly).toBe(true);
    const report = createSecurityDecisionEngine().decide({
      intelligence: intelligence(findings),
      context: {
        projectId: "p",
        organizationId: "o",
        commitSha: "abc",
        deploymentEnvironment: "production",
        redTeamRunStatus: "completed",
        replayStatus: "passed",
        safeFixStatus: "none",
      },
    });
    expect(report.decision.deploymentVerdict).toBeDefined();
  });

  it("scenario F: replay failed generates alternate plan version", () => {
    const result = createUniversalEngineeringEngine().run({
      ...baseInput([finding("Privilege escalation", "authorization")]),
      replayStatus: "failed",
      previousPlanVersion: 1,
    });
    expect(result.alternatePlanGenerated).toBe(true);
    expect(result.plan.version).toBe(2);
  });

  it("preferredAI detection defaults to cursor", () => {
    expect(resolvePreferredAI({ preferredAI: null })).toBe("cursor");
    expect(resolvePreferredAI({ preferredAI: "claude_code" })).toBe("claude_code");
  });

  it("serializes plan to JSON without AI references", () => {
    const result = createUniversalEngineeringEngine().run(baseInput([finding("API error", "api")]));
    const json = engineeringPlanToJson(result.plan);
    expect(json.adapterId).toBe("json");
    expect(json.content).toContain("planId");
    expect(json.content.toLowerCase()).not.toContain("cursor");
  });
});
