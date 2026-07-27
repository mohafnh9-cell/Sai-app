import { describe, expect, it } from "vitest";
import type { DiscoveryReport } from "../../../discovery/types";
import {
  analyzeBusinessDiscoverySignals,
  discoverBusinessEntities,
  discoverBusinessWorkflows,
} from "../index";

function baseDiscovery(overrides?: Partial<DiscoveryReport>): DiscoveryReport {
  return {
    reportId: "d1",
    projectId: "p1",
    organizationId: "o1",
    commitSha: "abc123",
    generatedAt: new Date().toISOString(),
    durationMs: 10,
    projectSummary: "",
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
    confidenceScore: 0.5,
    cached: false,
    ...overrides,
  };
}

describe("RT9 Workflow Discovery — Slice 1", () => {
  it("discovers no workflows for static/marketing profile without evidence", () => {
    const result = discoverBusinessWorkflows(
      baseDiscovery({
        projectSummary: "Marketing landing page",
        potentialAttackSurface: [{ area: "browser", label: "Browser", rationale: "x", confidence: 0.9 }],
      })
    );
    expect(result.workflows).toHaveLength(0);
    expect(result.entities).toHaveLength(0);
  });

  it("discovers payment and subscription workflows for Stripe + auth stack", () => {
    const discovery = baseDiscovery({
      projectSummary: "SaaS with subscription billing",
      payments: [{ id: "stripe", name: "Stripe", category: "payments", confidence: 0.95, evidence: ["package.json"] }],
      authenticationProviders: [
        { id: "clerk", name: "Clerk", category: "auth", confidence: 0.9, evidence: [] },
      ],
      potentialAttackSurface: [
        { area: "payments", label: "Payments", rationale: "Stripe", confidence: 0.92 },
        { area: "webhooks", label: "Webhooks", rationale: "Stripe webhooks", confidence: 0.85 },
        { area: "rest_api", label: "REST", rationale: "Next API", confidence: 0.88 },
        { area: "authentication", label: "Auth", rationale: "Clerk", confidence: 0.9 },
      ],
    });
    const result = discoverBusinessWorkflows(discovery);
    const kinds = result.workflows.map((w) => w.kind);
    expect(kinds).toContain("payment_checkout");
    expect(kinds).toContain("payment_webhook_settlement");
    expect(kinds).toContain("subscription_lifecycle");

    for (const workflow of result.workflows) {
      expect(workflow.confidence).toBeGreaterThanOrEqual(0.65);
      expect(workflow.evidence.length).toBeGreaterThan(0);
      expect(workflow.businessObjective.length).toBeGreaterThan(10);
      expect(workflow.actors.length).toBeGreaterThan(0);
      expect(workflow.resources.length).toBeGreaterThan(0);
    }
  });

  it("does not infer coupon workflow without summary evidence", () => {
    const discovery = baseDiscovery({
      payments: [{ id: "stripe", name: "Stripe", category: "payments", confidence: 0.9, evidence: [] }],
      authenticationProviders: [
        { id: "clerk", name: "Clerk", category: "auth", confidence: 0.9, evidence: [] },
      ],
      potentialAttackSurface: [
        { area: "payments", label: "Payments", rationale: "x", confidence: 0.9 },
        { area: "authentication", label: "Auth", rationale: "x", confidence: 0.9 },
      ],
    });
    const result = discoverBusinessWorkflows(discovery);
    expect(result.workflows.some((w) => w.kind === "coupon_redemption")).toBe(false);
  });

  it("infers coupon workflow when summary and payments evidence exist", () => {
    const result = discoverBusinessWorkflows(
      baseDiscovery({
        projectSummary: "Supports promo codes at checkout",
        payments: [{ id: "stripe", name: "Stripe", category: "payments", confidence: 0.9, evidence: [] }],
        potentialAttackSurface: [{ area: "payments", label: "Pay", rationale: "x", confidence: 0.9 }],
      })
    );
    expect(result.workflows.some((w) => w.kind === "coupon_redemption")).toBe(true);
  });

  it("discovers admin workflow only with admin_area surface", () => {
    const withAdmin = discoverBusinessWorkflows(
      baseDiscovery({
        potentialAttackSurface: [{ area: "admin_area", label: "Admin", rationale: "x", confidence: 0.85 }],
      })
    );
    expect(withAdmin.workflows.some((w) => w.kind === "admin_business_operations")).toBe(true);

    const withoutAdmin = discoverBusinessWorkflows(baseDiscovery());
    expect(withoutAdmin.workflows.some((w) => w.kind === "admin_business_operations")).toBe(false);
  });

  it("entity discovery dedupes by kind and links evidence", () => {
    const signals = analyzeBusinessDiscoverySignals(
      baseDiscovery({
        payments: [{ id: "stripe", name: "Stripe", category: "payments", confidence: 0.9, evidence: [] }],
        authenticationProviders: [
          { id: "clerk", name: "Clerk", category: "auth", confidence: 0.9, evidence: [] },
        ],
        potentialAttackSurface: [{ area: "payments", label: "Pay", rationale: "x", confidence: 0.9 }],
      })
    );
    const entities = discoverBusinessEntities(baseDiscovery(), signals);
    const kinds = entities.map((e) => e.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds).toContain("payment");
    expect(kinds).toContain("subscription");
  });

  it("reuses API inventory read-only for webhook hints", () => {
    const signals = analyzeBusinessDiscoverySignals(
      baseDiscovery({
        potentialAttackSurface: [
          { area: "rest_api", label: "REST", rationale: "x", confidence: 0.9 },
          { area: "webhooks", label: "Hooks", rationale: "x", confidence: 0.85 },
        ],
      })
    );
    expect(signals.webhookEndpoints.some((p) => /webhook/i.test(p))).toBe(true);
    expect(signals.apiSurface.hasWebhooks).toBe(true);
  });
});
