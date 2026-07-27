import { randomUUID } from "node:crypto";
import type { DiscoveryReport } from "../../discovery/types";
import { buildApiSurfaceFromDiscovery } from "../../teams/api/discovery/api-surface-builder";
import type { BusinessDiscoveryEvidence, BusinessDiscoverySignals } from "./discovery.types";

function evidence(
  source: BusinessDiscoveryEvidence["source"],
  detail: string,
  confidence: number
): BusinessDiscoveryEvidence {
  return { id: randomUUID(), source, detail, confidence };
}

export function analyzeBusinessDiscoverySignals(discovery: DiscoveryReport): BusinessDiscoverySignals {
  const apiSurface = buildApiSurfaceFromDiscovery(discovery);
  const surface = discovery.potentialAttackSurface;

  const paymentProviders = discovery.payments.map((p) => p.name);
  const hasPaymentsSurface = surface.some((s) => s.area === "payments");
  const hasWebhooksSurface = surface.some((s) => s.area === "webhooks");
  const hasRestApi = surface.some((s) => s.area === "rest_api" || s.area === "graphql");
  const hasAuthentication =
    discovery.authenticationProviders.length > 0 || surface.some((s) => s.area === "authentication");
  const hasAdminArea = surface.some((s) => s.area === "admin_area");
  const databaseTechnologies = discovery.database.map((d) => d.name);
  const hasDatabase = databaseTechnologies.length > 0;

  const webhookEndpoints =
    hasRestApi || hasWebhooksSurface
      ? apiSurface.endpoints
          .filter((e) => e.tags.includes("webhook") || /webhook/i.test(e.path))
          .map((e) => e.path)
      : [];

  const billingRouteHints = hasRestApi
    ? apiSurface.endpoints
        .filter((e) => /checkout|billing|subscribe|stripe|payment/i.test(e.path))
        .map((e) => e.path)
    : [];

  const summary = discovery.projectSummary.toLowerCase();
  const summaryHints = {
    credits: /\bcredit(s)?\b|\btoken(s)?\b.*(balance|usage)/i.test(summary),
    quotas: /\bquota(s)?\b|\brate limit(s)?\b.*(plan|tier)/i.test(summary),
    coupons: /\bcoupon(s)?\b|\bpromo(code)?\b|\bdiscount code/i.test(summary),
    invitations: /\binvit(?:e|ation|ations)\b|\breferral\b|\bwaitlist\b/i.test(summary),
    subscriptions: /\bsubscription(s)?\b|\bbilling cycle\b|\btrial\b/i.test(summary),
  };

  return {
    paymentProviders,
    hasPaymentsSurface,
    hasWebhooksSurface,
    hasRestApi,
    hasAuthentication,
    hasAdminArea,
    hasDatabase,
    databaseTechnologies,
    webhookEndpoints,
    billingRouteHints,
    summaryHints,
    apiSurface,
  };
}

export function hasPaymentStack(signals: BusinessDiscoverySignals): boolean {
  return signals.paymentProviders.length > 0 || signals.hasPaymentsSurface;
}

export function paymentProviderLabel(signals: BusinessDiscoverySignals): string {
  return signals.paymentProviders[0] ?? "payment_provider";
}

export { evidence as businessDiscoveryEvidence };
