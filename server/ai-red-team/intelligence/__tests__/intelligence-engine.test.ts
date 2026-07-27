import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { AttackFinding, AttackResult } from "../../types";
import {
  correlateFindings,
  buildAttackChains,
  buildGraphFromRun,
  assessBusinessImpact,
  rankRemediationPriorities,
  buildIntelligenceProductionVerdict,
  linkFindingsToMemory,
  scoreFindingConfidence,
  aggregateConfidence,
  buildFounderExplanation,
  groupSafeFixPlans,
  runSecurityIntelligence,
  deduplicateObservations,
  normalizeObservations,
} from "../index";
import type { DiscoveryReport } from "../../discovery/types";
import type { NormalizedObservation } from "../models";

function discoveryFixture(): DiscoveryReport {
  return {
    reportId: "disc-1",
    projectId: "p1",
    organizationId: "o1",
    commitSha: "abc",
    generatedAt: new Date().toISOString(),
    durationMs: 10,
    projectSummary: "Test app",
    detectedTechnologies: [
      { id: "next", name: "Next.js", category: "framework", confidence: 0.9, evidence: [] },
    ],
    authenticationProviders: [{ id: "auth", name: "Auth", category: "auth", confidence: 0.8, evidence: [] }],
    database: [],
    payments: [{ id: "stripe", name: "Stripe", category: "payments", confidence: 0.9, evidence: [] }],
    aiProviders: [],
    infrastructure: [],
    deployment: [],
    storage: [],
    packageManagers: ["npm"],
    potentialAttackSurface: [
      { area: "authentication", label: "Auth", rationale: "login", confidence: 0.8 },
      { area: "admin_area", label: "Admin", rationale: "admin routes", confidence: 0.7 },
    ],
    technologyGraph: { nodes: [], edges: [] },
    confidenceScore: 0.82,
    cached: false,
  };
}

function finding(partial: Partial<AttackFinding> & Pick<AttackFinding, "id" | "title">): AttackFinding {
  return {
    description: partial.description ?? "desc",
    domain: partial.domain ?? "browser",
    severity: partial.severity ?? "medium",
    confidence: partial.confidence ?? 0.8,
    evidenceIds: partial.evidenceIds ?? [],
    metadata: partial.metadata ?? {},
    ...partial,
  };
}

function observationsFixture(): NormalizedObservation[] {
  return [
    {
      ...finding({
        id: "f1",
        title: "Sensitive session data in localStorage",
        severity: "high",
        metadata: {
          team: "browser",
          route: "/dashboard",
          correlationKeys: ["localstorage-auth"],
          safeFixEligible: true,
          remediationDirection: "Move tokens to HttpOnly cookies",
        },
      }),
      team: "browser",
      route: "/dashboard",
      correlationKeys: ["localstorage-auth"],
    },
    {
      ...finding({
        id: "f2",
        title: "Missing Content-Security-Policy header",
        severity: "medium",
        metadata: {
          team: "browser",
          route: "/",
          correlationKeys: ["localstorage-auth"],
          safeFixEligible: true,
        },
      }),
      team: "browser",
      route: "/",
      correlationKeys: ["localstorage-auth"],
    },
    {
      ...finding({
        id: "f3",
        title: "Client-side error visible in console",
        severity: "low",
        metadata: { team: "browser", route: "/dashboard", correlationKeys: [] },
      }),
      team: "browser",
      route: "/dashboard",
      correlationKeys: [],
    },
  ];
}

function browserResult(findings: AttackFinding[]): AttackResult {
  return {
    agentId: "surface.browser",
    agentName: "Browser Team",
    domain: "browser",
    status: "completed",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 100,
    findings,
    evidence: [],
    logs: [],
  };
}

describe("Security Intelligence Engine RT4", () => {
  it("correlates findings sharing correlation keys into attack chains", () => {
    const correlations = correlateFindings(observationsFixture());
    expect(correlations.some((c) => c.kind === "attack_chain" || c.kind === "duplicate")).toBe(true);
  });

  it("deduplicates near-duplicate observations", () => {
    const obs = observationsFixture();
    const dup = [...obs, { ...obs[0], id: "f1-dup" }];
    const deduped = deduplicateObservations(dup);
    expect(deduped.length).toBeLessThan(dup.length);
  });

  it("builds an attack graph with findings and surfaces", () => {
    const discovery = discoveryFixture();
    const results = [browserResult(observationsFixture())];
    const graph = buildGraphFromRun({ discovery, results });
    expect(graph.nodes.some((n) => n.kind === "finding")).toBe(true);
    expect(graph.nodes.some((n) => n.kind === "authentication" || n.id.startsWith("surface:"))).toBe(true);
  });

  it("constructs ranked attack chains", () => {
    const obs = observationsFixture();
    const correlations = correlateFindings(obs);
    const graph = buildGraphFromRun({
      discovery: discoveryFixture(),
      results: [browserResult(obs)],
    });
    const chains = buildAttackChains({ observations: obs, correlations, graph });
    expect(chains.length).toBeGreaterThan(0);
    expect(chains[0]?.steps.length).toBeGreaterThanOrEqual(2);
  });

  it("translates findings into business impact language", () => {
    const impacts = assessBusinessImpact(observationsFixture());
    expect(impacts[0]?.headline.toLowerCase()).toContain("session");
  });

  it("ranks remediation priorities", () => {
    const obs = observationsFixture();
    const impacts = assessBusinessImpact(obs);
    const chains = buildAttackChains({
      observations: obs,
      correlations: correlateFindings(obs),
      graph: buildGraphFromRun({ discovery: discoveryFixture(), results: [browserResult(obs)] }),
    });
    const priorities = rankRemediationPriorities({ observations: obs, impacts, chains });
    expect(priorities[0]?.findingId).toBe("f1");
    expect(["fix_immediately", "fix_before_production"]).toContain(priorities[0]?.priority);
  });

  it("produces a unified production verdict", () => {
    const obs = observationsFixture();
    const impacts = assessBusinessImpact(obs);
    const priorities = rankRemediationPriorities({
      observations: obs,
      impacts,
      chains: [],
    });
    const confidences = obs.map((o) =>
      scoreFindingConfidence({ observation: o, discovery: discoveryFixture() })
    );
    const verdict = buildIntelligenceProductionVerdict({
      observations: obs,
      priorities,
      impacts,
      confidences,
      chains: [],
      coverage: ["browser"],
    });
    expect(verdict.status).toBe("DO_NOT_DEPLOY");
    expect(verdict.topRisks.length).toBeGreaterThan(0);
  });

  it("links memory for regressions", () => {
    const links = linkFindingsToMemory(observationsFixture(), {
      events: [
        {
          type: "safe_fix_generated",
          occurredAt: new Date().toISOString(),
          payload: { title: "Sensitive session data in localStorage" },
        },
      ],
    });
    expect(links[0]?.previouslyFixed).toBe(true);
  });

  it("generates founder-friendly explanations", () => {
    const obs = observationsFixture();
    const explanation = buildFounderExplanation({
      observations: obs,
      deduplicated: obs,
      correlations: correlateFindings(obs),
      chains: [],
      priorities: rankRemediationPriorities({
        observations: obs,
        impacts: assessBusinessImpact(obs),
        chains: [],
      }),
      topBlockerTitle: obs[0]?.title ?? null,
    });
    expect(explanation.headline.toLowerCase()).toContain("deployment blocker");
    expect(explanation.rawFindingCount).toBe(3);
  });

  it("groups safe fix plans by attack chain", () => {
    const obs = observationsFixture();
    const correlations = correlateFindings(obs);
    const chains = buildAttackChains({
      observations: obs,
      correlations,
      graph: buildGraphFromRun({ discovery: discoveryFixture(), results: [browserResult(obs)] }),
    });
    const plans = groupSafeFixPlans({
      observations: obs,
      chains,
      priorities: rankRemediationPriorities({
        observations: obs,
        impacts: assessBusinessImpact(obs),
        chains,
      }),
    });
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.some((p) => p.findingIds.length >= 2)).toBe(true);
  });

  it("runs end-to-end intelligence analysis on browser results", () => {
    const obs = observationsFixture();
    const report = runSecurityIntelligence({
      discovery: discoveryFixture(),
      results: [browserResult(obs)],
    });
    expect(report.attackChains.length).toBeGreaterThan(0);
    expect(report.verdict.status).toBeTruthy();
    expect(report.groupedSafeFixPlans.length).toBeGreaterThan(0);
    expect(aggregateConfidence(report.findingConfidences)).not.toBe("unknown");
  });
});

describe("Browser Team → Intelligence integration", () => {
  it("normalizes browser metadata for correlation", () => {
    const results = [browserResult(observationsFixture())];
    const normalized = normalizeObservations(results);
    expect(normalized.every((n) => n.team === "browser")).toBe(true);
    expect(normalized.filter((n) => n.correlationKeys.includes("localstorage-auth")).length).toBe(2);
  });
});
