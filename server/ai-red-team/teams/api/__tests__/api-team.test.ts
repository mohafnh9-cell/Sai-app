import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createApiTeamCoordinator,
  createApiSpecialistRegistry,
  createDefaultApiSpecialists,
  buildApiSurfaceFromDiscovery,
  dedupeApiFindings,
} from "../index";
import { mockSafeApiRuntimeFactory } from "../runtime/mock-api-runtime";
import { assertSafeApiRequest } from "../runtime/safe-api-runtime";
import type { AttackAuthorizationRecord } from "../../authorization";
import type { DiscoveryReport } from "../../../discovery/types";

function auth(origin: string): AttackAuthorizationRecord {
  return {
    id: randomUUID(),
    organizationId: "org-internal",
    projectId: "project-1",
    targetOrigin: origin,
    environmentType: "preview",
    status: "approved",
    authorizationMethod: "test",
    approvedScope: {},
    createdBy: null,
    approvedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    testCredentialsRef: null,
    pathExclusions: [],
    redirectAllowlist: [],
    maxRequestBudget: 100,
    maxDurationSeconds: 600,
    commitSha: "abc",
  };
}

function discovery(): DiscoveryReport {
  return {
    reportId: "d1",
    projectId: "project-1",
    organizationId: "org-internal",
    commitSha: "abc",
    generatedAt: new Date().toISOString(),
    durationMs: 1,
    projectSummary: "",
    detectedTechnologies: [{ id: "next", name: "Next.js", category: "framework", confidence: 0.9, evidence: [] }],
    authenticationProviders: [],
    database: [],
    payments: [],
    aiProviders: [],
    infrastructure: [],
    deployment: [],
    storage: [],
    packageManagers: [],
    potentialAttackSurface: [{ area: "rest_api", label: "REST", rationale: "x", confidence: 0.9 }],
    technologyGraph: { nodes: [], edges: [] },
    confidenceScore: 0.8,
    cached: false,
  };
}

describe("API Team RT7", () => {
  const prev = process.env.SEQURAI_INTERNAL_ORG_IDS;
  beforeEach(() => {
    process.env.SEQURAI_INTERNAL_ORG_IDS = "org-internal";
  });
  afterEach(() => {
    process.env.SEQURAI_INTERNAL_ORG_IDS = prev;
  });

  it("builds surface inventory from discovery", () => {
    const surface = buildApiSurfaceFromDiscovery(discovery());
    expect(surface.hasRest).toBe(true);
    expect(surface.endpoints.length).toBeGreaterThan(0);
  });

  it("blocks destructive and cross-origin API requests", () => {
    const authorization = auth("https://api.fixture.local");
    expect(() =>
      assertSafeApiRequest({
        method: "DELETE",
        path: "/api/users/1",
        authorization,
        origin: "https://api.fixture.local",
      })
    ).toThrow(/blocked/i);
  });

  it("runs coordinator and produces findings with replay plans", async () => {
    const origin = "https://api.fixture.local";
    const coordinator = createApiTeamCoordinator({
      registry: createApiSpecialistRegistry(createDefaultApiSpecialists()),
      runtimeFactory: mockSafeApiRuntimeFactory,
    });
    const result = await coordinator.run({
      organizationId: "org-internal",
      projectId: "project-1",
      runId: randomUUID(),
      requestId: randomUUID(),
      targetOrigin: origin,
      environment: "preview",
      authorization: auth(origin),
      discoveryReport: discovery(),
      plan: { planId: "p", createdAt: new Date().toISOString(), phases: [], notes: [] },
    });
    expect(result.endpointsDiscovered).toBeGreaterThan(0);
    expect(result.findings.some((f) => f.category === "cors")).toBe(true);
    expect(result.replayPlans.length).toBeGreaterThan(0);
    expect(result.safeFixCandidateCount).toBeGreaterThan(0);
  });

  it("deduplicates findings", () => {
    const base = {
      team: "api" as const,
      specialist: "api.cors",
      category: "cors",
      title: "Same",
      founderSummary: "a",
      technicalExplanation: "b",
      route: "/api/users",
      method: "OPTIONS",
      severity: "high" as const,
      confidence: 0.8,
      status: "candidate" as const,
      correlationKeys: [],
      safeFixEligible: true,
      remediationDirection: "fix",
      replayEligible: true,
      provenance: ["runtime"],
      discoveredAt: new Date().toISOString(),
    };
    const out = dedupeApiFindings([
      { ...base, findingId: "1" },
      { ...base, findingId: "2" },
    ]);
    expect(out.filter((f) => f.status === "duplicate")).toHaveLength(1);
  });
});
