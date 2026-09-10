import { describe, expect, it } from "vitest";
import { createFakeAdmin, type FakeTables } from "@/server/mcp/__tests__/fake-admin";
import { deriveAttackChainStatus, persistSecurityIntelligence } from "../persistence";
import type { AttackFinding } from "../../types/attack-models";
import type { AttackChain, SecurityIntelligenceReport } from "../models";

const ORG_A = "org-a";
const PROJECT_A = "project-a";
const SCAN_A = "scan-a";

function finding(overrides: Partial<AttackFinding> & { id: string }): AttackFinding {
  return {
    title: "Weak authorization on /api/projects/:id",
    description: "Object ownership is not checked before returning the resource.",
    domain: "api" as AttackFinding["domain"],
    severity: "high",
    confidence: 0.5,
    evidenceIds: [],
    ...overrides,
  };
}

function chain(findingIds: string[]): AttackChain {
  return {
    id: "chain-1",
    steps: findingIds.map((id) => ({ findingId: id, nodeId: `finding:${id}`, label: id })),
    severity: "high",
    score: 8,
    findingIds,
    summary: "Correlated chain across findings",
  };
}

function baseReport(overrides: Partial<SecurityIntelligenceReport> = {}): SecurityIntelligenceReport {
  return {
    reportId: "report-1",
    generatedAt: new Date().toISOString(),
    graph: { nodes: [], edges: [] },
    correlations: [],
    attackChains: [],
    businessImpacts: [],
    priorities: [],
    findingConfidences: [],
    verdict: {
      status: "UNKNOWN",
      summary: "",
      businessExplanation: "",
      technicalExplanation: "",
      topRisks: [],
      topFixes: [],
      confidence: "unknown",
      coverage: [],
      generatedAt: new Date().toISOString(),
    },
    explanation: {
      headline: "",
      paragraphs: [],
      groupedFindingCount: 0,
      rawFindingCount: 0,
      estimatedRiskReductionPercent: null,
    },
    memoryLinks: [],
    groupedSafeFixPlans: [],
    deduplicatedFindings: [],
    ...overrides,
  };
}

describe("Phase 34 -- deriveAttackChainStatus", () => {
  it("does NOT mark a chain CONFIRMED just because it has several findings with no evidence", () => {
    const findings = [
      finding({ id: "f1", confidence: 0.9, evidenceIds: [] }),
      finding({ id: "f2", confidence: 0.9, evidenceIds: [] }),
      finding({ id: "f3", confidence: 0.9, evidenceIds: [] }),
    ];
    const byId = new Map(findings.map((f) => [f.id, f]));
    const status = deriveAttackChainStatus(chain(["f1", "f2", "f3"]), byId);
    expect(status).toBe("POTENTIAL");
  });

  it("is PARTIALLY_VALIDATED when exactly one constituent finding has captured evidence", () => {
    const findings = [
      finding({ id: "f1", confidence: 0.9, evidenceIds: ["ev-1"] }),
      finding({ id: "f2", confidence: 0.5, evidenceIds: [] }),
    ];
    const byId = new Map(findings.map((f) => [f.id, f]));
    const status = deriveAttackChainStatus(chain(["f1", "f2"]), byId);
    expect(status).toBe("PARTIALLY_VALIDATED");
  });

  it("is CONFIRMED only when at least two constituent findings are independently high-confidence AND evidenced", () => {
    const findings = [
      finding({ id: "f1", confidence: 0.9, evidenceIds: ["ev-1"] }),
      finding({ id: "f2", confidence: 0.87, evidenceIds: ["ev-2"] }),
    ];
    const byId = new Map(findings.map((f) => [f.id, f]));
    const status = deriveAttackChainStatus(chain(["f1", "f2"]), byId);
    expect(status).toBe("CONFIRMED");
  });

  it("high confidence alone (no evidence) never reaches CONFIRMED", () => {
    const findings = [
      finding({ id: "f1", confidence: 0.99, evidenceIds: [] }),
      finding({ id: "f2", confidence: 0.99, evidenceIds: [] }),
    ];
    const byId = new Map(findings.map((f) => [f.id, f]));
    const status = deriveAttackChainStatus(chain(["f1", "f2"]), byId);
    expect(status).toBe("POTENTIAL");
  });
});

describe("Phase 34 -- persistSecurityIntelligence", () => {
  function tables(): FakeTables {
    return { attack_chains: [], finding_correlations: [] };
  }

  it("persists correlation groups and attack chains as queryable rows instead of discarding them", async () => {
    const t = tables();
    const admin = createFakeAdmin(t);

    const f1 = finding({ id: "f1", confidence: 0.9, evidenceIds: ["ev-1"] });
    const f2 = finding({ id: "f2", confidence: 0.9, evidenceIds: ["ev-2"] });
    const report = baseReport({
      deduplicatedFindings: [f1, f2],
      correlations: [
        { id: "corr-1", kind: "attack_chain", findingIds: ["f1", "f2"], confidence: 0.8, rationale: "shared route" },
      ],
      attackChains: [chain(["f1", "f2"])],
    });

    const result = await persistSecurityIntelligence(admin as never, {
      organizationId: ORG_A,
      projectId: PROJECT_A,
      scanId: SCAN_A,
      report,
    });

    expect(result).toEqual({ correlationsPersisted: 1, chainsPersisted: 1 });
    expect(t.attack_chains).toHaveLength(1);
    expect(t.attack_chains?.[0]).toMatchObject({
      organization_id: ORG_A,
      project_id: PROJECT_A,
      scan_id: SCAN_A,
      status: "CONFIRMED",
      finding_ids: ["f1", "f2"],
    });
    expect(t.finding_correlations).toHaveLength(1);
    expect(t.finding_correlations?.[0]).toMatchObject({
      organization_id: ORG_A,
      scan_id: SCAN_A,
      kind: "attack_chain",
      finding_ids: ["f1", "f2"],
    });
  });

  it("is a no-op (zero rows) when the report has no correlations or chains, without throwing", async () => {
    const t = tables();
    const admin = createFakeAdmin(t);
    const result = await persistSecurityIntelligence(admin as never, {
      organizationId: ORG_A,
      projectId: PROJECT_A,
      scanId: SCAN_A,
      report: baseReport(),
    });
    expect(result).toEqual({ correlationsPersisted: 0, chainsPersisted: 0 });
    expect(t.attack_chains).toHaveLength(0);
    expect(t.finding_correlations).toHaveLength(0);
  });
});
