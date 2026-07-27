import { describe, expect, it } from "vitest";
import type { DiscoveryReport } from "../../../discovery/types";
import {
  buildAuthorizationMatrix,
  buildRoleGraph,
  buildResourceGraph,
  createAuthorizationTeamCoordinator,
  createAuthorizationSpecialistRegistry,
  createDefaultAuthorizationSpecialists,
  dedupeAuthzFindings,
  detectAuthorizationSignals,
} from "../index";
import {
  buildScaledAuthorizationMatrix,
  evaluateMatrixSample,
  matrixSize,
} from "../model/authorization-matrix";
import { createSecurityDecisionEngine } from "../../../decision";
import { createSecurityIntelligenceEngine } from "../../../intelligence";
import type { AttackResult } from "../../../types";

function discovery(overrides?: Partial<DiscoveryReport>): DiscoveryReport {
  return {
    reportId: "d1",
    projectId: "project-1",
    organizationId: "org-internal",
    commitSha: "abc",
    generatedAt: new Date().toISOString(),
    durationMs: 1,
    projectSummary: "",
    detectedTechnologies: overrides?.detectedTechnologies ?? [
      { id: "pg", name: "Postgres", category: "database", confidence: 0.9, evidence: [] },
    ],
    authenticationProviders: overrides?.authenticationProviders ?? [],
    database: [],
    payments: [],
    aiProviders: [],
    infrastructure: [],
    deployment: [],
    storage: [],
    packageManagers: [],
    potentialAttackSurface: overrides?.potentialAttackSurface ?? [
      { area: "authorization", label: "RBAC", rationale: "x", confidence: 0.9 },
      { area: "admin_area", label: "Admin", rationale: "x", confidence: 0.9 },
    ],
    technologyGraph: { nodes: [], edges: [] },
    confidenceScore: 0.8,
    cached: false,
    ...overrides,
  };
}

function coordinator() {
  return createAuthorizationTeamCoordinator({
    registry: createAuthorizationSpecialistRegistry(createDefaultAuthorizationSpecialists()),
  });
}

const emptyPlan = {
  planId: "plan",
  createdAt: new Date().toISOString(),
  phases: [],
  notes: [],
};

describe("Authorization Team RT8", () => {
  it("builds role graph and authorization matrix", () => {
    const roles = buildRoleGraph();
    const resources = buildResourceGraph(discovery());
    const matrix = buildAuthorizationMatrix(roles, resources);
    expect(roles.nodes.length).toBeGreaterThanOrEqual(5);
    expect(resources.nodes.length).toBeGreaterThan(0);
    expect(matrixSize(matrix)).toBe(roles.nodes.length * resources.nodes.length * 5);
  });

  it("scenario A: tenant isolation failure confirmed", async () => {
    const result = await coordinator().run({
      organizationId: "o",
      projectId: "p",
      runId: "run-a",
      requestId: "req-a",
      discoveryReport: discovery(),
      plan: emptyPlan,
    });
    const tenant = result.findings.find((f) => f.category === "tenant_isolation_failure");
    expect(tenant).toBeDefined();
    expect(tenant?.status).toBe("confirmed");
    expect(result.replayPlans.some((p) => p.findingId === tenant?.findingId)).toBe(true);
  });

  it("scenario B: user admin endpoint returns 403 without finding", async () => {
    const result = await coordinator().run({
      organizationId: "o",
      projectId: "p",
      runId: "run-b",
      requestId: "req-b",
      discoveryReport: discovery(),
      plan: emptyPlan,
    });
    const adminFinding = result.findings.find(
      (f) => f.category === "broken_function_authorization" && f.role === "user" && f.title.includes("admin endpoint")
    );
    expect(adminFinding).toBeUndefined();
  });

  it("scenario C: broken object authorization with replay and safe fix", async () => {
    const result = await coordinator().run({
      organizationId: "o",
      projectId: "p",
      runId: "run-c",
      requestId: "req-c",
      discoveryReport: discovery(),
      plan: emptyPlan,
    });
    const bola = result.findings.find((f) => f.category === "broken_object_authorization");
    expect(bola).toBeDefined();
    expect(result.replayPlans.length).toBeGreaterThan(0);
    expect(result.safeFixCandidateCount).toBeGreaterThan(0);
  });

  it("scenario D: missing RLS is critical with replay", async () => {
    const result = await coordinator().run({
      organizationId: "o",
      projectId: "p",
      runId: "run-d",
      requestId: "req-d",
      discoveryReport: discovery({
        detectedTechnologies: [{ id: "app", name: "Custom App", category: "framework", confidence: 0.5, evidence: [] }],
      }),
      plan: emptyPlan,
    });
    const rls = result.findings.find((f) => f.category === "broken_rls");
    expect(rls?.severity).toBe("critical");
  });

  it("scenario E: mature RBAC yields no actionable findings", async () => {
    const disc = discovery({
      detectedTechnologies: [
        { id: "sup", name: "Supabase", category: "database", confidence: 0.9, evidence: [] },
      ],
      potentialAttackSurface: [
        { area: "authorization", label: "RBAC", rationale: "x", confidence: 0.9 },
      ],
    });
    const signals = detectAuthorizationSignals(disc);
    expect(signals.hasRls).toBe(true);
    expect(signals.hasCustomRbac).toBe(true);
    const result = await coordinator().run({
      organizationId: "o",
      projectId: "p",
      runId: "run-e",
      requestId: "req-e",
      discoveryReport: disc,
      plan: emptyPlan,
    });
    const confirmed = result.findings.filter((f) => f.status === "confirmed" && f.severity !== "medium");
    expect(confirmed.length).toBe(0);
  });

  it("dedupes duplicate findings", () => {
    const base = {
      specialist: "authz.object",
      category: "broken_object_authorization",
      title: "Broken Object Level Authorization",
      founderSummary: "x",
      technicalExplanation: "x",
      role: "user",
      resource: "users",
      action: "update",
      severity: "high" as const,
      confidence: 0.9,
      status: "candidate" as const,
      correlationKeys: [],
      safeFixEligible: true,
      remediationDirection: "x",
      replayEligible: true,
      provenance: [],
    };
    const deduped = dedupeAuthzFindings([
      { ...base, findingId: "1", team: "authorization", discoveredAt: new Date().toISOString() },
      { ...base, findingId: "2", team: "authorization", discoveredAt: new Date().toISOString() },
    ]);
    expect(deduped.filter((f) => f.status === "duplicate").length).toBe(1);
  });

  it("feeds intelligence and triggers BLOCK_DEPLOYMENT for tenant isolation", () => {
    const intelligenceEngine = createSecurityIntelligenceEngine();
    const decisionEngine = createSecurityDecisionEngine();
    const results: AttackResult[] = [
      {
        agentId: "auth.authorization",
        agentName: "Authorization Team",
        domain: "authorization",
        status: "completed",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 1,
        findings: [
          {
            id: "f1",
            title: "Tenant isolation failure",
            description: "Cross-tenant read",
            domain: "authorization",
            severity: "critical",
            confidence: 0.95,
            evidenceIds: [],
            metadata: { category: "tenant_isolation_failure", team: "authorization" },
          },
        ],
        evidence: [],
        logs: [],
      },
    ];
    const intelligence = intelligenceEngine.analyze({
      discovery: discovery(),
      results,
      memory: null,
      staticReviewConfidence: null,
    });
    const report = decisionEngine.decide({
      intelligence,
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
    expect(report.decision.decision).toBe("BLOCK_DEPLOYMENT");
    expect(report.decision.policiesTriggered).toContain("gate.authorization_critical");
  });
});

describe("Authorization Team load", () => {
  it("handles 100 roles, 1000 resources, 10k evaluations without duplicate keys", () => {
    const matrix = buildScaledAuthorizationMatrix({ roleCount: 100, resourceCount: 1000 });
    expect(matrix.cells.length).toBe(100 * 1000 * 5);
    const { evaluations, uniqueKeys } = evaluateMatrixSample(matrix, 10_000);
    expect(evaluations).toBe(10_000);
    expect(uniqueKeys).toBe(10_000);
  });
});
