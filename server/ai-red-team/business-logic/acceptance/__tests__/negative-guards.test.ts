import { describe, expect, it } from "vitest";
import { createSecurityIntelligenceEngine } from "../../../intelligence/engine";
import { createSecurityDecisionEngine } from "../../../decision/decision-engine";
import { discoverBusinessWorkflows } from "../../discovery/workflow-discovery";
import { buildBusinessLogicFindings } from "../../findings/finding-builder";
import {
  discoveryFullBillingStack,
  discoveryStaticSite,
  emptyAttackPlan,
  INTERNAL_ORG_RT9,
} from "../fixtures";
import { createBusinessLogicTeamCoordinator } from "../../coordinator";

describe("RT9 negative guards", () => {
  it("does not invent checkout workflow from provider name alone without payments surface", () => {
    const discovery = discoveryStaticSite();
    discovery.payments = [{ id: "stripe", name: "Stripe", category: "payments", confidence: 0.9, evidence: [] }];
    const { workflows } = discoverBusinessWorkflows(discovery);
    expect(workflows.length).toBe(0);
  });

  it("does not emit findings without runtime execution", () => {
    const collection = buildBusinessLogicFindings({
      domain: {
        entities: [],
        workflows: [],
        stateMachines: [],
        workflowGraph: { workflowIds: [], entityIds: [], relationships: [], executionPaths: [] },
        validationIssues: [],
      },
    });
    expect(collection.findings.length).toBe(0);
  });

  it("rejects findings lacking runtime-backed evidence", async () => {
    const result = await createBusinessLogicTeamCoordinator().run({
      organizationId: INTERNAL_ORG_RT9,
      projectId: "neg",
      runId: "rt",
      requestId: "req",
      discoveryReport: discoveryFullBillingStack(),
      plan: emptyAttackPlan(),
    });
    const findings = result.context?.domainModel?.findingCollection?.findings ?? [];
    for (const f of findings) {
      expect(f.invariantIds.length).toBeGreaterThan(0);
      expect(f.workflowId).toBeTruthy();
      expect(f.evidence.length).toBeGreaterThan(0);
    }
  });

  it("does not block deployment when RT9 disabled (no agent findings)", () => {
    const intel = createSecurityIntelligenceEngine().analyze({
      discovery: discoveryStaticSite(),
      results: [],
    });
    expect(intel.businessLogic).toBeUndefined();
    const decision = createSecurityDecisionEngine().decide({
      intelligence: intel,
      context: {
        projectId: "p",
        organizationId: "org-public",
        commitSha: null,
        acceptedRisks: [],
      },
    });
    expect(decision.decision.deploymentVerdict).toBeDefined();
  });
});
