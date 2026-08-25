import { afterAll, describe, expect, it } from "vitest";
import { createBusinessLogicTeamCoordinator } from "../../coordinator";
import { BusinessLogicTeamAgent } from "../../business-logic-team-agent";
import {
  discoveryFullBillingStack,
  discoveryInsufficientEvidence,
  discoverySecureCheckout,
  discoveryStaticSite,
  emptyAttackPlan,
  INTERNAL_ORG_RT9,
} from "../fixtures";
import { createInMemoryBusinessLogicRunStore, persistBusinessLogicRun } from "../../persistence";
import { createBusinessLogicSpecialistRegistry, createDefaultBusinessLogicSpecialists } from "../../registry";
import { CheckoutIntegritySpecialist } from "../../specialists/checkout-integrity-specialist";
import { isFeatureEnabled } from "@/server/feature-flags";
import { createSecurityIntelligenceEngine } from "../../../intelligence/engine";
import { createSecurityDecisionEngine } from "../../../decision/decision-engine";
import { buildDecisionContextFromRequest } from "../../../decision/build-decision-context";
import { resolveDirectorPipelineDomains } from "../../../director/pipeline";
import type { AttackRequest } from "../../../types";
import { createUniversalEngineeringEngine } from "../../../engineering/uee-engine";
import { planBusinessLogicOrchestrationMetadata } from "../../../autonomous-orchestrator/business-logic-orchestration";
import { buildMissionControlView } from "@/features/mission-control/lib/build-mission-control-view";
import { BusinessLogicTeamAgent as AgentClass } from "../../business-logic-team-agent";
import { withFeatureFlagOverrides } from "../../../__tests__/test-support/feature-flag-override";

class InjectedFailingCheckoutSpecialist extends CheckoutIntegritySpecialist {
  readonly id = "logic.checkout_integrity";
  readonly priority = 1;
  async plan() {
    throw new Error("injected specialist failure");
  }
}

const prevOrg = process.env.SEQURAI_INTERNAL_ORG_IDS;

async function runRt9(discovery: ReturnType<typeof discoveryFullBillingStack>, org = INTERNAL_ORG_RT9) {
  const coordinator = createBusinessLogicTeamCoordinator();
  return coordinator.run({
    organizationId: org,
    projectId: "proj-acc",
    runId: "rt-acc",
    requestId: "req-acc",
    discoveryReport: discovery,
    plan: emptyAttackPlan(),
  });
}

describe("RT9 acceptance suite — Slice 10", () => {
  process.env.SEQURAI_INTERNAL_ORG_IDS = INTERNAL_ORG_RT9;

  describe("Scenario A — secure checkout structure", () => {
    it("discovers checkout workflow, FSM, invariants; findings are evidence-backed", async () => {
      const result = await runRt9(discoverySecureCheckout());
      expect(result.workflowsDiscovered).toBeGreaterThan(0);
      expect(result.context?.domainModel?.stateMachines.length).toBeGreaterThan(0);
      expect(result.invariantsExtracted).toBeGreaterThan(0);
      const findings = result.context?.domainModel?.findingCollection?.findings ?? [];
      for (const f of findings) {
        expect(f.evidence.some((e) => e.source === "runtime" || e.source === "fsm")).toBe(true);
        expect(f.confidence).not.toBe("unsupported");
      }
    });
  });

  describe("Scenario B — fulfillment before payment", () => {
    it("produces checkout specialist activity and replay metadata when violations simulated", async () => {
      const result = await runRt9(discoveryFullBillingStack());
      const specialists = result.context?.domainModel?.specialistExecution?.results ?? [];
      expect(specialists.some((s) => s.specialistId.includes("checkout"))).toBe(true);
      expect(result.abuseHypothesesGenerated).toBeGreaterThan(0);
      expect(result.runtimeExecutionsCompleted).toBeGreaterThan(0);
      const findings = result.context?.domainModel?.findingCollection?.findings ?? [];
      if (findings.length > 0) {
        expect(findings[0]?.replayPlan.sequence.steps.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Scenario C — duplicate webhook fulfillment", () => {
    it("includes webhook workflow and deduplicated findings", async () => {
      const result = await runRt9(discoveryFullBillingStack());
      const kinds = result.context?.workflows.map((w) => w.kind) ?? [];
      expect(kinds).toContain("payment_webhook_settlement");
      const findings = result.context?.domainModel?.findingCollection?.findings ?? [];
      const keys = findings.map((f) => f.findingKey);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });

  describe("Scenario D — concurrent credit double spend", () => {
    it("includes credit/quota workflow and race-related abuse categories", async () => {
      const discovery = discoveryFullBillingStack();
      discovery.projectSummary += " Credits and quota limits apply.";
      const result = await runRt9(discovery);
      const kinds = result.context?.workflows.map((w) => w.kind) ?? [];
      expect(kinds.some((k) => k === "credit_quota")).toBe(true);
      const abuse = result.context?.domainModel?.abuseCollection?.cases ?? [];
      expect(
        abuse.some((a) => a.category === "race_condition" || a.category === "concurrent_execution")
      ).toBe(true);
    });
  });

  describe("Scenario E — coupon replay", () => {
    it("includes coupon workflow and correlates duplicate root causes", async () => {
      const discovery = discoveryFullBillingStack();
      discovery.projectSummary += " Coupon promo codes enabled.";
      const result = await runRt9(discovery);
      expect(result.context?.workflows.some((w) => w.kind === "coupon_redemption")).toBe(true);
      const findings = result.context?.domainModel?.findingCollection?.findings ?? [];
      expect(new Set(findings.map((f) => f.findingKey)).size).toBe(findings.length);
    });
  });

  describe("Scenario F — expired invitation reuse", () => {
    it("includes invitation workflow and membership specialist eligibility", async () => {
      const discovery = discoveryFullBillingStack();
      discovery.projectSummary += " Team invitations and referrals.";
      const result = await runRt9(discovery);
      expect(result.context?.workflows.some((w) => w.kind === "invitation_referral")).toBe(true);
      const specialists = result.context?.domainModel?.specialistExecution?.results ?? [];
      expect(specialists.some((s) => s.specialistId.includes("invitation"))).toBe(true);
    });
  });

  describe("Scenario G — subscription after cancellation", () => {
    it("includes subscription lifecycle workflow and specialist", async () => {
      const result = await runRt9(discoveryFullBillingStack());
      expect(result.context?.workflows.some((w) => w.kind === "subscription_lifecycle")).toBe(true);
      const specialists = result.context?.domainModel?.specialistExecution?.results ?? [];
      expect(specialists.some((s) => s.specialistId.includes("subscription"))).toBe(true);
    });
  });

  describe("Scenario H — static website", () => {
    it("defers with zero workflows and zero findings", async () => {
      const result = await runRt9(discoveryStaticSite());
      expect(result.workflowsDiscovered).toBe(0);
      expect(result.findingsCount).toBe(0);
      expect(result.deferralReason).toMatch(/deferred|No business workflows/i);
    });
  });

  describe("Scenario I — insufficient evidence", () => {
    it("does not emit confirmed findings without provider evidence", async () => {
      const result = await runRt9(discoveryInsufficientEvidence());
      expect(result.findingsCount).toBe(0);
    });
  });

  describe("Scenario J — specialist failure isolation", () => {
    it("continues after one specialist fails without fabricated findings from failure", async () => {
      const registry = createBusinessLogicSpecialistRegistry([
        new InjectedFailingCheckoutSpecialist(),
        ...createDefaultBusinessLogicSpecialists().filter(
          (s) => s.id !== "logic.checkout_integrity"
        ),
      ]);
      const coordinator = createBusinessLogicTeamCoordinator({ registry });
      const result = await coordinator.run({
        organizationId: INTERNAL_ORG_RT9,
        projectId: "proj-j",
        runId: "rt-j",
        requestId: "req-j",
        discoveryReport: discoveryFullBillingStack(),
        plan: emptyAttackPlan(),
      });
      const exec = result.context?.domainModel?.specialistExecution;
      expect(exec?.specialistsFailed).toBeGreaterThanOrEqual(1);
      expect(exec?.specialistsCompleted).toBeGreaterThanOrEqual(1);
      const findings = result.context?.domainModel?.findingCollection?.findings ?? [];
      for (const f of findings) {
        expect(f.metadata.specialistId).not.toBe("logic.checkout_integrity");
      }
    });
  });

  describe("Scenario K — RT9 disabled", () => {
    it("agent cannot run and pipeline omits payments domain", async () => {
      // business_logic_team is "ga" (enabled for every org) by default now —
      // it was "internal"-gated when this scenario was written. Demote it
      // via a fresh module evaluation to exercise the disabled path.
      await withFeatureFlagOverrides({ business_logic_team: "internal" }, async () => {
        const { isFeatureEnabled: isFeatureEnabledFresh } = await import("@/server/feature-flags");
        const { createBusinessLogicTeamCoordinator: createCoordinatorFresh } = await import(
          "../../coordinator"
        );
        const { BusinessLogicTeamAgent: AgentClassFresh } = await import(
          "../../business-logic-team-agent"
        );
        const { resolveDirectorPipelineDomains: resolveFresh } = await import(
          "../../../director/pipeline"
        );

        const agent = new AgentClassFresh(createCoordinatorFresh());
        const can = await agent.canRun({
          projectId: "p",
          organizationId: "org-public-no-rt9",
          declaredCapabilities: ["payments"],
          metadata: { businessLogicAttack: { discovery: discoveryFullBillingStack(), plan: emptyAttackPlan() } },
        });
        expect(can).toBe(false);
        expect(
          isFeatureEnabledFresh("business_logic_team", { organizationId: "org-public-no-rt9" })
        ).toBe(false);

        const request = {
          context: { organizationId: "org-public-no-rt9", projectId: "p" },
          directorPipeline: true,
        } as AttackRequest;
        expect(resolveFresh(request)).not.toContain("payments");
      });
    });
  });

  describe("Scenario L — persistence retry", () => {
    it("idempotent persist does not duplicate artifact rows", async () => {
      const store = createInMemoryBusinessLogicRunStore();
      const result = await runRt9(discoveryFullBillingStack());
      const input = {
        result,
        organizationId: INTERNAL_ORG_RT9,
        projectId: "proj-l",
        idempotencyKey: "idem-l",
      };
      const first = await persistBusinessLogicRun(input, { store });
      const second = await persistBusinessLogicRun(input, { store });
      expect(first?.counts.findings).toBe(second?.counts.findings);
      expect(second?.revision).toBe(2);
      const artifacts = store.getArtifacts(result.businessLogicTeamRunId);
      expect(artifacts?.workflows.length).toBe(first?.counts.workflows);
    });
  });

  describe("RT4 / RT5 / RT12 / RT13 bridges", () => {
    it("integrates with intelligence, decision, UEE, and ASO metadata", async () => {
      const agent = new BusinessLogicTeamAgent(createBusinessLogicTeamCoordinator());
      const attack = await agent.execute({
        requestId: "req-bridge",
        signal: undefined,
        context: {
          organizationId: INTERNAL_ORG_RT9,
          projectId: "proj-bridge",
          declaredCapabilities: ["payments"],
          metadata: {
            businessLogicAttack: {
              discovery: discoveryFullBillingStack(),
              plan: emptyAttackPlan(),
            },
          },
        },
      });
      const intel = createSecurityIntelligenceEngine().analyze({
        discovery: discoveryFullBillingStack(),
        results: [attack],
      });
      expect(intel.businessLogic?.findingSummary).toBeTruthy();
      const decision = createSecurityDecisionEngine().decide({
        intelligence: intel,
        context: buildDecisionContextFromRequest(
          { context: { organizationId: INTERNAL_ORG_RT9, projectId: "proj-bridge" } } as AttackRequest,
          "abc"
        ),
      });
      expect(decision.decision.metadata?.businessLogicDecisionExposure).toBeTruthy();
      const uee = createUniversalEngineeringEngine().run({
        organizationId: INTERNAL_ORG_RT9,
        projectId: "proj-bridge",
        requestId: "req-uee",
        discovery: discoveryFullBillingStack(),
        intelligence: intel,
        results: [attack],
      });
      expect(uee.businessLogicRemediationInputs?.length).toBe(attack.findings.length);
      const aso = planBusinessLogicOrchestrationMetadata({
        discovery: discoveryFullBillingStack(),
        businessLogicEnabled: true,
      });
      expect(aso?.autoExecute).toBe(false);
    });
  });

  describe("Mission Control acceptance", () => {
    it("uses platform metrics as authoritative progress for business_logic team", async () => {
      const agent = new BusinessLogicTeamAgent(createBusinessLogicTeamCoordinator());
      const attack = await agent.execute({
        requestId: "req-mc",
        signal: undefined,
        context: {
          organizationId: INTERNAL_ORG_RT9,
          projectId: "proj-mc",
          declaredCapabilities: ["payments"],
          metadata: {
            businessLogicAttack: {
              discovery: discoveryFullBillingStack(),
              plan: emptyAttackPlan(),
            },
          },
        },
      });
      const metrics = attack.metadata?.businessLogicMetrics as { coveragePercent: number; findingsCount: number };
      const view = buildMissionControlView({
        projectId: "proj-mc",
        projectName: "MC",
        verdict: null,
        scanInProgress: false,
        detectedStack: { billing: "stripe" },
        feedFromDb: [],
        teamExecution: { business_logic: "completed" },
        businessLogicMetrics: metrics,
      });
      const bl = view.teams.find((t) => t.id === "business_logic")!;
      expect(bl.progressPercent).toBe(metrics.coveragePercent);
      expect(bl.estimatedDurationLabel).toContain(String(metrics.findingsCount));
    });
  });

  afterAll(() => {
    if (prevOrg === undefined) delete process.env.SEQURAI_INTERNAL_ORG_IDS;
    else process.env.SEQURAI_INTERNAL_ORG_IDS = prevOrg;
  });
});
