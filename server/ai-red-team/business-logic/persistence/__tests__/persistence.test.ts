import { afterAll, describe, expect, it } from "vitest";
import { createBusinessLogicTeamCoordinator } from "../../coordinator";
import { BusinessLogicTeamAgent } from "../../business-logic-team-agent";
import {
  createInMemoryBusinessLogicRunStore,
  persistBusinessLogicRun,
  recoverPartialBusinessLogicRun,
  chunkRows,
  serializeBusinessLogicArtifacts,
} from "../index";
import { isBusinessLogicPersistenceEnabled } from "../feature-gate";
import { buildOperationalMetrics } from "../../observability/telemetry";
import { buildBusinessLogicPlatformPayload } from "../../integration/platform-payload";
import type { DiscoveryReport } from "../../../discovery/types";

const INTERNAL_ORG = "org-internal-rt9-persist";
const prev = process.env.SEQURAI_INTERNAL_ORG_IDS;

function richDiscovery(): DiscoveryReport {
  return {
    reportId: "d1",
    projectId: "p1",
    organizationId: INTERNAL_ORG,
    commitSha: "abc",
    generatedAt: new Date().toISOString(),
    durationMs: 1,
    projectSummary: "Stripe SaaS",
    detectedTechnologies: [],
    authenticationProviders: [],
    database: [],
    payments: [{ id: "stripe", name: "Stripe", category: "payments", confidence: 0.95, evidence: [] }],
    aiProviders: [],
    infrastructure: [],
    deployment: [],
    storage: [],
    packageManagers: [],
    potentialAttackSurface: [
      { area: "payments", label: "Pay", rationale: "x", confidence: 0.9 },
      { area: "webhooks", label: "Hooks", rationale: "x", confidence: 0.85 },
      { area: "rest_api", label: "API", rationale: "x", confidence: 0.88 },
    ],
    technologyGraph: { nodes: [], edges: [] },
    confidenceScore: 0.9,
    cached: false,
  };
}

describe("RT9 persistence — Slice 9", () => {
  process.env.SEQURAI_INTERNAL_ORG_IDS = INTERNAL_ORG;

  it("persists full run artifacts in memory", async () => {
    const store = createInMemoryBusinessLogicRunStore();
    const coordinator = createBusinessLogicTeamCoordinator();
    const result = await coordinator.run({
      organizationId: INTERNAL_ORG,
      projectId: "proj-persist",
      runId: "rt-1",
      requestId: "req-persist",
      discoveryReport: richDiscovery(),
      plan: { planId: "p", createdAt: new Date().toISOString(), phases: [], notes: [] },
    });

    const outcome = await persistBusinessLogicRun(
      {
        result,
        organizationId: INTERNAL_ORG,
        projectId: "proj-persist",
        idempotencyKey: "idem-1",
      },
      { store }
    );

    expect(outcome?.persisted).toBe(true);
    expect(outcome?.revision).toBe(1);
    expect(outcome!.counts.workflows).toBe(result.workflowsDiscovered);
    expect(outcome!.counts.findings).toBe(result.findingsCount);

    const stored = await store.getRun(result.businessLogicTeamRunId);
    expect(stored?.findingsCount).toBe(result.findingsCount);
    const artifacts = store.getArtifacts(result.businessLogicTeamRunId);
    expect(artifacts?.workflows.length).toBe(result.workflowsDiscovered);
    expect(artifacts?.replayPlans.length).toBe(result.findingsCount);
  });

  it("retry-safe idempotent persist increments revision", async () => {
    const store = createInMemoryBusinessLogicRunStore();
    const coordinator = createBusinessLogicTeamCoordinator();
    const result = await coordinator.run({
      organizationId: INTERNAL_ORG,
      projectId: "proj-retry",
      runId: "rt-2",
      requestId: "req-retry",
      discoveryReport: richDiscovery(),
      plan: { planId: "p", createdAt: new Date().toISOString(), phases: [], notes: [] },
    });

    await persistBusinessLogicRun(
      { result, organizationId: INTERNAL_ORG, projectId: "proj-retry", idempotencyKey: "idem-retry" },
      { store }
    );
    const second = await persistBusinessLogicRun(
      { result, organizationId: INTERNAL_ORG, projectId: "proj-retry", idempotencyKey: "idem-retry" },
      { store }
    );
    expect(second?.revision).toBe(2);
    expect(store.getRevision(result.businessLogicTeamRunId)).toBe(2);
  });

  it("partial recovery marks run partially_completed", async () => {
    const store = createInMemoryBusinessLogicRunStore();
    const coordinator = createBusinessLogicTeamCoordinator();
    const result = await coordinator.run({
      organizationId: INTERNAL_ORG,
      projectId: "proj-partial",
      runId: "rt-3",
      requestId: "req-partial",
      discoveryReport: richDiscovery(),
      plan: { planId: "p", createdAt: new Date().toISOString(), phases: [], notes: [] },
    });

    const outcome = await recoverPartialBusinessLogicRun(
      { result, organizationId: INTERNAL_ORG, projectId: "proj-partial" },
      { store }
    );
    const header = await store.getRun(result.businessLogicTeamRunId);
    expect(outcome?.partialPersistence).toBe(true);
    expect(header?.status).toBe("partially_completed");
  });

  it("agent persists when persistence flag and store are enabled", async () => {
    const store = createInMemoryBusinessLogicRunStore();
    const agent = new BusinessLogicTeamAgent(createBusinessLogicTeamCoordinator(), store);
    const attack = await agent.execute({
      requestId: "req-agent-persist",
      signal: undefined,
      context: {
        organizationId: INTERNAL_ORG,
        projectId: "proj-agent",
        declaredCapabilities: ["payments"],
        metadata: {
          businessLogicAttack: {
            discovery: richDiscovery(),
            plan: { planId: "p", createdAt: new Date().toISOString(), phases: [], notes: [] },
          },
        },
      },
    });
    expect(attack.metadata?.persistenceRevision).toBe(1);
    expect(attack.metadata?.operationalMetrics).toBeTruthy();
  });

  it("chunkRows supports large finding batches", () => {
    const rows = Array.from({ length: 1200 }, (_, i) => i);
    const chunks = chunkRows(rows, 250);
    expect(chunks.length).toBe(5);
    expect(chunks.flat().length).toBe(1200);
  });

  it("scalability: serialize 500 synthetic findings without throwing", () => {
    const artifacts = serializeBusinessLogicArtifacts({
      businessLogicTeamRunId: "run-scale",
      status: "completed",
      analysisPhase: "RT9_FINDINGS_COMPLETE",
      executionMode: "analysis",
      findingsCount: 500,
      workflowsDiscovered: 50,
      invariantsExtracted: 200,
      abuseHypothesesGenerated: 150,
      specialistObservationsGenerated: 80,
      specialistsCompleted: 5,
      runtimeExecutionsCompleted: 40,
      durationMs: 100,
      context: {
        businessLogicTeamRunId: "run-scale",
        redTeamRunId: "rt",
        organizationId: INTERNAL_ORG,
        projectId: "p",
        commitSha: null,
        discovery: richDiscovery(),
        plan: { planId: "p", createdAt: new Date().toISOString(), phases: [], notes: [] },
        signals: {} as never,
        entities: [],
        workflows: [],
        domainModel: {
          entities: [],
          workflows: [],
          stateMachines: [],
          workflowGraph: { workflowIds: [], entityIds: [], relationships: [], executionPaths: [] },
          validationIssues: [],
          findingCollection: {
            id: "fc",
            generatedAt: new Date().toISOString(),
            findings: Array.from({ length: 500 }, (_, i) => ({
              findingId: `f-${i}`,
              findingKey: `k-${i}`,
              title: `Finding ${i}`,
              description: "d",
              category: "invariant_violation" as const,
              severity: "medium" as const,
              confidence: "likely" as const,
              status: "candidate" as const,
              workflowId: `w-${i % 50}`,
              workflowKind: "payment_checkout",
              entityIds: [],
              invariantIds: [],
              invariantKeys: [],
              transitionIds: [],
              specialistIds: [],
              businessImpact: "x",
              economicImpact: "x",
              replayPlan: {
                id: `rp-${i}`,
                findingId: `f-${i}`,
                preconditions: [],
                sequence: { id: "s", steps: [] },
                expectedOutcome: "x",
                validationCriteria: [],
                evidence: [],
                executable: false,
              },
              mitigation: { summary: "m", recommendations: [], hintsFromAbuse: [] },
              evidence: [],
              supportingAssumptions: [],
              executionSummary: "x",
              correlation: {
                keys: [],
                workflowId: `w-${i % 50}`,
                invariantId: "i",
                invariantKey: "k",
                abuseCaseId: null,
                abuseKey: null,
                workflowKind: "payment_checkout",
                businessValueKind: "monetary",
              },
              metadata: {
                businessLogicTeamRunId: "run-scale",
                executionId: "e",
                planId: "p",
                specialistId: "s",
                executionMode: "mock_runtime",
                executionClassification: "likely",
                abuseCategory: null,
                generatedAt: new Date().toISOString(),
              },
            })),
            validationIssues: [],
          },
        },
      },
    });
    expect(artifacts.findings.length).toBe(500);
    expect(artifacts.replayPlans.length).toBe(500);
  });

  it("operational metrics expose budget and success counters", async () => {
    const coordinator = createBusinessLogicTeamCoordinator();
    const result = await coordinator.run({
      organizationId: INTERNAL_ORG,
      projectId: "proj-metrics",
      runId: "rt-m",
      requestId: "req-m",
      discoveryReport: richDiscovery(),
      plan: { planId: "p", createdAt: new Date().toISOString(), phases: [], notes: [] },
    });
    const platform = buildBusinessLogicPlatformPayload(result);
    const metrics = buildOperationalMetrics({ platform, teamDurationMs: result.durationMs });
    expect(metrics.workflowCount).toBeGreaterThanOrEqual(0);
    expect(metrics.budgetEvaluationsUsed).toBeGreaterThanOrEqual(0);
  });

  it("persistence flag requires business_logic_team", () => {
    expect(
      isBusinessLogicPersistenceEnabled({ organizationId: INTERNAL_ORG })
    ).toBe(true);
    expect(
      isBusinessLogicPersistenceEnabled({ organizationId: "org-public" })
    ).toBe(false);
  });

  afterAll(() => {
    if (prev === undefined) delete process.env.SEQURAI_INTERNAL_ORG_IDS;
    else process.env.SEQURAI_INTERNAL_ORG_IDS = prev;
  });
});
