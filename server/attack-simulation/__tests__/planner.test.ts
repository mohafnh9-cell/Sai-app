import { describe, expect, it } from "vitest";
import {
  ATTACK_ADAPTER_CATALOG,
  attackHypothesisFromRedTeamFinding,
  planScenariosFromHypotheses,
  resolveAdapterForHypothesis,
} from "@/server/attack-simulation";

describe("attack planner", () => {
  const campaignId = "11111111-1111-4111-8111-111111111111";
  const projectId = "55555555-5555-4555-8555-555555555555";
  const organizationId = "66666666-6666-4666-8666-666666666666";

  it("maps red team findings into attack hypotheses", () => {
    const hypothesis = attackHypothesisFromRedTeamFinding({
      id: "finding-1",
      title: "Cross-tenant record access",
      description: "Tenant B can read tenant A project by IDOR",
      category: "authorization",
      severity: "high",
      confidence: 0.82,
      source: "auth.authorization",
      metadata: { adapterHint: "idor-cross-tenant" },
    });

    expect(hypothesis.adapterHint).toBe("idor-cross-tenant");
    expect(hypothesis.severity).toBe("high");
  });

  it("resolves MVP adapter ids from hypothesis text", () => {
    const adapter = resolveAdapterForHypothesis({
      category: "llm",
      title: "RAG indirect prompt injection via uploaded doc",
      description: "Retrieved context may execute attacker instructions",
    });
    expect(adapter.id).toBe("rag-prompt-injection");
  });

  it("plans scenarios under a campaign with sort order", () => {
    const result = planScenariosFromHypotheses({
      campaignId,
      organizationId,
      projectId,
      runtimeMode: "mock",
      hypotheses: [
        attackHypothesisFromRedTeamFinding({
          id: "h1",
          title: "Unauthenticated admin route",
          description: "Route accepts requests without session",
          category: "authentication",
          severity: "high",
          confidence: 0.9,
          source: "surface.api",
        }),
        attackHypothesisFromRedTeamFinding({
          id: "h2",
          title: "Webhook signature bypass",
          description: "Missing HMAC validation on webhook endpoint",
          category: "webhook",
          severity: "medium",
          confidence: 0.7,
          source: "surface.api",
        }),
      ],
    });

    expect(result.planned).toHaveLength(2);
    expect(result.planned[0].scenarioInput.sortOrder).toBe(0);
    expect(result.planned[1].scenarioInput.sortOrder).toBe(1);
    expect(result.planned[0].scenarioInput.adapterId).toBe("unauthenticated-endpoint");
    expect(result.planned[1].scenarioInput.adapterId).toBe("webhook-signature-bypass");
  });

  it("skips adapters that are incompatible with runtime mode", () => {
    const result = planScenariosFromHypotheses({
      campaignId,
      organizationId,
      projectId,
      runtimeMode: "static",
      hypotheses: [
        attackHypothesisFromRedTeamFinding({
          id: "h-webhook",
          title: "Webhook signature bypass",
          description: "Missing HMAC validation",
          category: "webhook",
          severity: "medium",
          confidence: 0.7,
          source: "surface.api",
          metadata: { adapterHint: "webhook-signature-bypass" },
        }),
      ],
    });

    expect(result.planned).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });

  it("covers all MVP adapters in the catalog", () => {
    expect(ATTACK_ADAPTER_CATALOG.length).toBeGreaterThanOrEqual(10);
  });
});
