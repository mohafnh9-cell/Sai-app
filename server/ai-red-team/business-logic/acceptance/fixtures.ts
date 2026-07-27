import type { DiscoveryReport } from "../../discovery/types";
import type { AttackPlan } from "../../types";

const BASE: Omit<DiscoveryReport, "projectSummary" | "potentialAttackSurface" | "payments"> = {
  reportId: "acceptance",
  projectId: "proj-accept",
  organizationId: "org-accept",
  commitSha: "deadbeef",
  generatedAt: "2026-01-01T00:00:00.000Z",
  durationMs: 1,
  detectedTechnologies: [],
  authenticationProviders: [],
  database: [],
  aiProviders: [],
  infrastructure: [],
  deployment: [],
  storage: [],
  packageManagers: [],
  technologyGraph: { nodes: [], edges: [] },
  confidenceScore: 0.85,
  cached: false,
};

export function emptyAttackPlan(): AttackPlan {
  return { planId: "plan-accept", createdAt: new Date().toISOString(), phases: [], notes: [] };
}

/** Scenario H — static marketing site. */
export function discoveryStaticSite(): DiscoveryReport {
  return {
    ...BASE,
    projectSummary: "Static marketing website with no backend billing.",
    payments: [],
    potentialAttackSurface: [],
  };
}

/** Scenario A — secure checkout signals without webhook/coupon noise. */
export function discoverySecureCheckout(): DiscoveryReport {
  return {
    ...BASE,
    projectSummary: "SaaS with Stripe checkout and authenticated customers.",
    payments: [{ id: "stripe", name: "Stripe", category: "payments", confidence: 0.92, evidence: [] }],
    authenticationProviders: [{ id: "clerk", name: "Clerk", category: "auth", confidence: 0.9, evidence: [] }],
    potentialAttackSurface: [
      { area: "payments", label: "Checkout", rationale: "Stripe", confidence: 0.9 },
      { area: "rest_api", label: "API", rationale: "REST", confidence: 0.85 },
      { area: "authentication", label: "Auth", rationale: "Clerk", confidence: 0.88 },
    ],
  };
}

/** Scenario B–G — full payment + webhook + subscription stack. */
export function discoveryFullBillingStack(): DiscoveryReport {
  return {
    ...BASE,
    projectSummary:
      "Subscription SaaS with Stripe checkout, webhooks, coupons, invitations, credits and quotas.",
    payments: [{ id: "stripe", name: "Stripe", category: "payments", confidence: 0.95, evidence: [] }],
    authenticationProviders: [{ id: "auth", name: "Auth", category: "auth", confidence: 0.9, evidence: [] }],
    database: [{ id: "pg", name: "PostgreSQL", category: "database", confidence: 0.88, evidence: [] }],
    potentialAttackSurface: [
      { area: "payments", label: "Pay", rationale: "x", confidence: 0.9 },
      { area: "webhooks", label: "Hooks", rationale: "x", confidence: 0.88 },
      { area: "rest_api", label: "API", rationale: "x", confidence: 0.9 },
      { area: "authentication", label: "Auth", rationale: "x", confidence: 0.85 },
      { area: "admin_area", label: "Admin", rationale: "x", confidence: 0.8 },
    ],
  };
}

/** Scenario I — weak evidence (no qualifying payments surface). */
export function discoveryInsufficientEvidence(): DiscoveryReport {
  return {
    ...BASE,
    projectSummary: "Unknown billing integration.",
    payments: [],
    potentialAttackSurface: [],
  };
}

export const INTERNAL_ORG_RT9 = "org-internal-rt9-accept";
