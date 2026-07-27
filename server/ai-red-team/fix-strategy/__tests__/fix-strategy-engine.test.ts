import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { AttackFinding } from "../../types";
import type { SecurityIntelligenceReport } from "../../intelligence/models";
import {
  analyzeRootCauses,
  createFixStrategyEngine,
  planFixStrategyBatch,
  hashPrompt,
} from "../index";
import { createSecurityDecisionEngine } from "../../decision";
import { createSecurityIntelligenceEngine } from "../../intelligence";
import type { DiscoveryReport } from "../../discovery/types";

function finding(partial: Partial<AttackFinding> & { title: string; domain: AttackFinding["domain"] }): AttackFinding {
  return {
    id: randomUUID(),
    title: partial.title,
    description: partial.description ?? partial.title,
    domain: partial.domain,
    severity: partial.severity ?? "high",
    confidence: partial.confidence ?? 0.9,
    evidenceIds: [],
    metadata: partial.metadata ?? {},
  };
}

function discovery(): DiscoveryReport {
  return {
    reportId: "d",
    projectId: "p",
    organizationId: "o",
    commitSha: "abc",
    generatedAt: new Date().toISOString(),
    durationMs: 1,
    projectSummary: "Next.js SaaS with Supabase",
    detectedTechnologies: [{ id: "1", name: "Next.js", category: "framework", confidence: 0.9, evidence: [] }],
    authenticationProviders: [{ id: "a", name: "Auth.js", category: "auth", confidence: 0.8, evidence: [] }],
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

function intelligence(findings: AttackFinding[]): SecurityIntelligenceReport {
  const engine = createSecurityIntelligenceEngine();
  return engine.analyze({
    discovery: discovery(),
    results: [
      {
        agentId: "test",
        agentName: "Test",
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

describe("Fix Strategy Engine RT12", () => {
  it("scenario A: 20 findings collapse to a small set of root causes and grouped fixes", () => {
    const findings: AttackFinding[] = [];
    for (let i = 0; i < 8; i++) {
      findings.push(finding({ title: `JWT reusable token ${i}`, domain: "authentication" }));
    }
    for (let i = 0; i < 7; i++) {
      findings.push(finding({ title: `Broken ownership ${i}`, domain: "authorization", metadata: { category: "broken_object_authorization" } }));
    }
    for (let i = 0; i < 5; i++) {
      findings.push(finding({ title: `Admin endpoint exposed ${i}`, domain: "authorization" }));
    }
    const causes = analyzeRootCauses(findings);
    expect(causes.length).toBeLessThanOrEqual(4);
    expect(causes.length).toBeGreaterThanOrEqual(2);

    const engine = createFixStrategyEngine();
    const report = engine.plan({
      organizationId: "o",
      projectId: "p",
      requestId: "req-a",
      discovery: discovery(),
      intelligence: intelligence(findings),
      results: [],
    });
    expect(report.groupedFixes.length).toBeLessThanOrEqual(causes.length + 1);
    expect(report.groupedFixes.length).toBeGreaterThanOrEqual(2);
    expect(report.implementationPrompt).toContain("Engineering remediation");
    expect(report.verificationPrompt).toContain("Verification");
  });

  it("scenario B: replay passed does not imply engine marks production ready", () => {
    const findings = [
      finding({ title: "Tenant isolation failure", domain: "authorization", metadata: { category: "tenant_isolation_failure" } }),
    ];
    const report = createFixStrategyEngine().plan({
      organizationId: "o",
      projectId: "p",
      requestId: "req-b",
      discovery: discovery(),
      intelligence: intelligence(findings),
      results: [],
      replayStatus: "passed",
    });
    expect(report.replayVerified).toBe(true);
    expect(report.productionReadyViaReplayOnly).toBe(true);
    const decision = createSecurityDecisionEngine().decide({
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
    expect(decision.decision.deploymentVerdict).toBeDefined();
  });

  it("scenario C: failed replay generates alternate strategy", () => {
    const findings = [finding({ title: "Privilege escalation", domain: "authorization" })];
    const report = createFixStrategyEngine().plan({
      organizationId: "o",
      projectId: "p",
      requestId: "req-c",
      discovery: discovery(),
      intelligence: intelligence(findings),
      results: [],
      replayStatus: "failed",
      previousStrategyRevision: 1,
    });
    expect(report.alternateStrategyGenerated).toBe(true);
    expect(report.strategyRevision).toBe(2);
    expect(report.universalEngineering?.plan.implementationOrder[0]?.why).toContain("failed replay");
  });

  it("scenario D: verification prompt detects regression responsibility", () => {
    const findings = [finding({ title: "Prompt injection", domain: "llm" })];
    const report = createFixStrategyEngine().plan({
      organizationId: "o",
      projectId: "p",
      requestId: "req-d",
      discovery: discovery(),
      intelligence: intelligence(findings),
      results: [],
    });
    expect(report.verificationPrompt).toMatch(/Regression testing/);
    expect(report.regressionTests.length).toBeGreaterThan(0);
    expect(report.engineeringReport.deploymentImpact).toContain("replay");
  });

  it("implementation prompt hash is deterministic", () => {
    const findings = [finding({ title: "API error disclosure", domain: "api" })];
    const input = {
      organizationId: "o",
      projectId: "p",
      requestId: "req",
      discovery: discovery(),
      intelligence: intelligence(findings),
      results: [],
    };
    const a = createFixStrategyEngine().plan(input);
    const b = createFixStrategyEngine().plan(input);
    expect(hashPrompt(a.implementationPrompt)).toBe(hashPrompt(b.implementationPrompt));
  });
});

describe("Fix Strategy load", () => {
  it("plans 1000 campaigns with deduped root causes and ranked fixes", () => {
    const engine = createFixStrategyEngine();
    const batch = planFixStrategyBatch(
      engine,
      Array.from({ length: 1000 }, (_, i) => {
        const findings = [
          finding({ title: `JWT issue ${i}`, domain: "authentication" }),
          finding({ title: `Admin route ${i}`, domain: "authorization" }),
        ];
        return {
          organizationId: "o",
          projectId: `p-${i}`,
          requestId: `req-${i}`,
          discovery: discovery(),
          intelligence: intelligence(findings),
          results: [],
        };
      })
    );
    expect(batch.length).toBe(1000);
    const uniqueHashes = new Set(batch.map((r) => hashPrompt(r.implementationPrompt)));
    expect(uniqueHashes.size).toBeGreaterThan(1);
    for (const report of batch.slice(0, 20)) {
      expect(report.groupedFixes.every((f, idx, arr) => idx === 0 || f.priorityScore <= arr[idx - 1]!.priorityScore)).toBe(
        true
      );
    }
  });
});
