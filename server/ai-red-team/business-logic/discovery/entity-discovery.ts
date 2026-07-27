import { randomUUID } from "node:crypto";
import type { BusinessDiscoverySignals, DiscoveredBusinessEntity } from "./discovery.types";
import { analyzeBusinessDiscoverySignals, businessDiscoveryEvidence, hasPaymentStack } from "./signals";
import type { DiscoveryReport } from "../../discovery/types";

export function discoverBusinessEntities(
  discovery: DiscoveryReport,
  signals: BusinessDiscoverySignals = analyzeBusinessDiscoverySignals(discovery)
): DiscoveredBusinessEntity[] {
  const entities: DiscoveredBusinessEntity[] = [];

  if (hasPaymentStack(signals)) {
    entities.push({
      id: randomUUID(),
      kind: "payment",
      label: "Customer payment",
      confidence: signals.paymentProviders.length > 0 ? 0.92 : 0.78,
      evidence: [
        ...(signals.paymentProviders.length > 0
          ? signals.paymentProviders.map((name) =>
              businessDiscoveryEvidence(
                "payment_provider",
                `Payment provider detected: ${name}`,
                0.9
              )
            )
          : [
              businessDiscoveryEvidence(
                "attack_surface",
                "Payments attack surface entry present in discovery",
                0.78
              ),
            ]),
      ],
    });
  }

  if (hasPaymentStack(signals) && signals.hasAuthentication) {
    entities.push({
      id: randomUUID(),
      kind: "subscription",
      label: "Customer subscription",
      confidence: signals.summaryHints.subscriptions ? 0.88 : 0.72,
      evidence: [
        businessDiscoveryEvidence(
          "payment_provider",
          "Billing stack with authenticated users — subscription lifecycle likely",
          signals.summaryHints.subscriptions ? 0.88 : 0.72
        ),
        businessDiscoveryEvidence("authentication", "Authentication provider present for account binding", 0.85),
      ],
    });
  }

  if (
    (signals.hasWebhooksSurface || signals.hasRestApi) &&
    (signals.hasWebhooksSurface || signals.webhookEndpoints.length > 0)
  ) {
    entities.push({
      id: randomUUID(),
      kind: "webhook_event",
      label: "Provider webhook event",
      confidence: signals.webhookEndpoints.length > 0 ? 0.9 : 0.75,
      evidence: [
        ...(signals.webhookEndpoints.length > 0
          ? signals.webhookEndpoints.map((path) =>
              businessDiscoveryEvidence("api_inventory", `Webhook route inventory: ${path}`, 0.88)
            )
          : [
              businessDiscoveryEvidence(
                "attack_surface",
                "Webhooks listed in discovery attack surface",
                0.75
              ),
            ]),
      ],
    });
  }

  if (
    signals.summaryHints.credits &&
    (hasPaymentStack(signals) || discovery.aiProviders.length > 0)
  ) {
    entities.push({
      id: randomUUID(),
      kind: "credit_balance",
      label: "Credit balance",
      confidence: 0.7,
      evidence: [
        businessDiscoveryEvidence("project_summary", "Project summary references credits or token balances", 0.68),
        ...(discovery.aiProviders.length > 0
          ? [
              businessDiscoveryEvidence(
                "discovery_report",
                `AI provider present (${discovery.aiProviders[0]?.name ?? "ai"}) — metered usage plausible`,
                0.65
              ),
            ]
          : []),
      ],
    });
  }

  if (signals.summaryHints.quotas && signals.hasAuthentication) {
    entities.push({
      id: randomUUID(),
      kind: "quota",
      label: "Usage quota",
      confidence: 0.68,
      evidence: [
        businessDiscoveryEvidence("project_summary", "Project summary references quotas or tier limits", 0.68),
        businessDiscoveryEvidence("authentication", "Authenticated users required for per-tenant quotas", 0.7),
      ],
    });
  }

  if (signals.summaryHints.coupons && hasPaymentStack(signals)) {
    entities.push({
      id: randomUUID(),
      kind: "coupon",
      label: "Coupon or promotion",
      confidence: 0.72,
      evidence: [
        businessDiscoveryEvidence("project_summary", "Project summary references coupons or promo codes", 0.72),
        businessDiscoveryEvidence("payment_provider", "Coupons typically attach to checkout or billing", 0.7),
      ],
    });
  }

  if (signals.summaryHints.invitations && signals.hasAuthentication) {
    entities.push({
      id: randomUUID(),
      kind: "invitation",
      label: "Invitation or referral",
      confidence: 0.7,
      evidence: [
        businessDiscoveryEvidence(
          "project_summary",
          "Project summary references invitations, referrals, or waitlist",
          0.7
        ),
        businessDiscoveryEvidence("authentication", "Invitations require identifiable accounts", 0.72),
      ],
    });
  }

  if (signals.hasAdminArea) {
    entities.push({
      id: randomUUID(),
      kind: "admin_config",
      label: "Administrative configuration",
      confidence: 0.8,
      evidence: [
        businessDiscoveryEvidence("attack_surface", "Admin area detected in attack surface", 0.8),
      ],
    });
  }

  if (signals.hasAuthentication) {
    entities.push({
      id: randomUUID(),
      kind: "user_account",
      label: "User account",
      confidence: 0.85,
      evidence: discovery.authenticationProviders.map((p) =>
        businessDiscoveryEvidence("authentication", `Auth provider: ${p.name}`, p.confidence)
      ),
    });
  }

  return dedupeEntitiesByKind(entities);
}

function dedupeEntitiesByKind(entities: DiscoveredBusinessEntity[]): DiscoveredBusinessEntity[] {
  const byKind = new Map<string, DiscoveredBusinessEntity>();
  for (const entity of entities) {
    const existing = byKind.get(entity.kind);
    if (!existing || entity.confidence > existing.confidence) {
      byKind.set(entity.kind, entity);
    }
  }
  return [...byKind.values()];
}
