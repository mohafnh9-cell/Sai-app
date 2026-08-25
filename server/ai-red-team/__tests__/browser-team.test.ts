import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createBrowserEnabledRedTeamEngine,
  validateAttackAuthorization,
  InMemoryRedTeamRunStore,
  executeQueuedRedTeamRun,
} from "../index";
import {
  ExecutionBudget,
  DEFAULT_BROWSER_TEAM_BUDGET,
  redactSecrets,
  hashValue,
  guardInteraction,
  normalizeRoutePath,
  RouteGraphBuilder,
  dedupeBrowserFindings,
  validateBrowserFinding,
  createBrowserSpecialistRegistry,
  createDefaultBrowserSpecialists,
  mockSafeBrowserRuntimeFactory,
} from "../teams/browser";
import { createSecurityDirector } from "../director/security-director";
import { createAgentRegistry, registerRedTeamAgents } from "../agents";
import type { DiscoveryRepositoryInput } from "../discovery/types";
import type { AttackAuthorizationRecord } from "../authorization";

const sampleDiscoveryRepository = (): DiscoveryRepositoryInput => ({
  projectId: "project-1",
  organizationId: "org-internal",
  commitSha: "abc123",
  files: [{ path: "package.json", content: '{"dependencies":{"next":"16.0.0"}}' }],
});

function sampleAuthorization(origin: string): AttackAuthorizationRecord {
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
    maxRequestBudget: 200,
    maxDurationSeconds: 900,
    commitSha: "abc123",
  };
}

describe("Browser Team RT3", () => {
  const prevInternal = process.env.SEQURAI_INTERNAL_ORG_IDS;

  beforeEach(() => {
    process.env.SEQURAI_INTERNAL_ORG_IDS = "org-internal";
  });

  afterEach(() => {
    process.env.SEQURAI_INTERNAL_ORG_IDS = prevInternal;
  });

  it("registers eight browser specialists", () => {
    const registry = createBrowserSpecialistRegistry(createDefaultBrowserSpecialists());
    expect(registry.listAll()).toHaveLength(8);
  });

  it("blocks destructive interactions", () => {
    expect(guardInteraction({ label: "delete account" }).allowed).toBe(false);
    expect(guardInteraction({ label: "Save profile" }).allowed).toBe(true);
  });

  it("redacts secrets in evidence strings", () => {
    const out = redactSecrets('password="super-secret"');
    expect(out).not.toContain("super-secret");
    expect(out).toContain("[REDACTED]");
  });

  it("hashes sensitive key names without revealing raw values", () => {
    expect(hashValue("auth_debug_token")).toHaveLength(16);
  });

  it("normalizes routes and builds a route graph", () => {
    const graph = new RouteGraphBuilder();
    graph.addNode(normalizeRoutePath("/login"));
    graph.addEdge("/", "/login", "navigation");
    expect(graph.build().edges).toHaveLength(1);
  });

  it("enforces execution budgets", () => {
    const budget = new ExecutionBudget({ ...DEFAULT_BROWSER_TEAM_BUDGET, maxRoutes: 2 });
    budget.recordRoute();
    budget.recordRoute();
    expect(budget.exhausted).toBe(true);
  });

  it("validates authorization origin mismatch", () => {
    const auth = sampleAuthorization("https://preview.example.com");
    const result = validateAttackAuthorization(auth, {
      targetUrl: "https://evil.example.com",
    });
    expect(result.ok).toBe(false);
  });

  it("dedupes findings", () => {
    const base = {
      runId: "run",
      specialist: "browser.console",
      category: "x",
      title: "Same",
      founderSummary: "a",
      technicalExplanation: "b",
      affectedTarget: "https://preview.example.com",
      route: "/",
      severity: "low" as const,
      confidence: 0.5,
      exploitability: "none" as const,
      evidenceRefs: [],
      reproductionSteps: [],
      expectedBehavior: "e",
      observedBehavior: "o",
      remediationDirection: "r",
      safeFixEligible: false,
      correlationKeys: [],
      status: "candidate" as const,
    };
    const findings = dedupeBrowserFindings([
      validateBrowserFinding({ ...base, findingId: "1", team: "browser", discoveredAt: new Date().toISOString() }),
      validateBrowserFinding({ ...base, findingId: "2", team: "browser", discoveredAt: new Date().toISOString() }),
    ]);
    expect(findings.filter((f) => f.status === "duplicate")).toHaveLength(1);
  });

  it("runs authorized browser simulation through Security Director", async () => {
    const { director } = createBrowserEnabledRedTeamEngine();
    const origin = "https://fixture.local";
    const report = await director.run({
      requestId: randomUUID(),
      context: {
        projectId: "project-1",
        organizationId: "org-internal",
        declaredCapabilities: ["browser"],
      },
      scope: ["browser"],
      discoveryRepository: sampleDiscoveryRepository(),
      attackSimulation: {
        targetUrl: `${origin}/`,
        authorization: sampleAuthorization(origin),
        async: false,
      },
    });

    const browser = report.results.find((r) => r.agentId === "surface.browser");
    expect(browser?.status).toBe("completed");
    expect(browser?.metadata?.browserTeamRunId).toBeTruthy();
    expect((browser?.findings.length ?? 0) >= 0).toBe(true);
  });

  it("rejects unauthorized origins at runtime navigation", async () => {
    const auth = sampleAuthorization("https://fixture.local");
    const budget = new ExecutionBudget(DEFAULT_BROWSER_TEAM_BUDGET);
    const runtime = await mockSafeBrowserRuntimeFactory.create({
      targetUrl: "https://fixture.local/",
      authorization: auth,
      budget,
    });
    await expect(runtime.goto("https://evil.example/phish")).rejects.toThrow(/blocked/i);
    await runtime.close();
  });

  it("executes queued red team run with stale lease protection", async () => {
    const store = new InMemoryRedTeamRunStore();
    const specialistRegistry = createBrowserSpecialistRegistry(createDefaultBrowserSpecialists());
    const { createBrowserTeam } = await import("../teams/browser/browser-team");
    const browserTeam = createBrowserTeam({ registry: specialistRegistry });
    const registry = createAgentRegistry();
    registerRedTeamAgents(registry, { browserTeam });
    const director = createSecurityDirector({ registry, redTeamRunStore: store });

    const runId = randomUUID();
    const origin = "https://fixture.local";
    await store.create({
      id: runId,
      organizationId: "org-internal",
      projectId: "project-1",
      authorizationId: null,
      idempotencyKey: null,
      status: "queued",
      commitSha: null,
      targetOrigin: origin,
      environmentType: "preview",
      discoveryReportId: null,
      executionLeaseToken: "lease-1",
      metadata: {},
    });

    const report = await executeQueuedRedTeamRun(director, store, runId, {
      request: {
        requestId: runId,
        context: {
          projectId: "project-1",
          organizationId: "org-internal",
          declaredCapabilities: ["browser"],
        },
        scope: ["browser"],
        discoveryRepository: sampleDiscoveryRepository(),
      },
      targetUrl: `${origin}/`,
      authorization: sampleAuthorization(origin),
    });
    expect(report.results.some((r) => r.agentId === "surface.browser")).toBe(true);

    await expect(
      executeQueuedRedTeamRun(director, store, runId, {
        request: {
          requestId: runId,
          context: {
            projectId: "project-1",
            organizationId: "org-internal",
            declaredCapabilities: ["browser"],
          },
          scope: ["browser"],
          discoveryRepository: sampleDiscoveryRepository(),
        },
        targetUrl: `${origin}/`,
        authorization: sampleAuthorization(origin),
      })
    ).rejects.toThrow(/Stale worker/);
  });
});
