import { randomUUID } from "node:crypto";
import type { DiscoveryReport } from "../../discovery/types";
import type {
  DiscoveredBusinessActor,
  DiscoveredBusinessResource,
  DiscoveredBusinessWorkflow,
  WorkflowDiscoveryResult,
} from "./discovery.types";
import {
  analyzeBusinessDiscoverySignals,
  businessDiscoveryEvidence,
  hasPaymentStack,
  paymentProviderLabel,
} from "./signals";
import { discoverBusinessEntities } from "./entity-discovery";

const MIN_WORKFLOW_CONFIDENCE = 0.65;

function actor(
  role: DiscoveredBusinessActor["role"],
  label: string,
  evidence: DiscoveredBusinessActor["evidence"]
): DiscoveredBusinessActor {
  return { id: randomUUID(), role, label, evidence };
}

function resource(
  kind: DiscoveredBusinessResource["kind"],
  label: string,
  evidence: DiscoveredBusinessResource["evidence"]
): DiscoveredBusinessResource {
  return { id: randomUUID(), kind, label, evidence };
}

export function discoverBusinessWorkflows(discovery: DiscoveryReport): WorkflowDiscoveryResult {
  const signals = analyzeBusinessDiscoverySignals(discovery);
  const entities = discoverBusinessEntities(discovery, signals);
  const workflows: DiscoveredBusinessWorkflow[] = [];

  if (hasPaymentStack(signals) && signals.hasPaymentsSurface) {
    const provider = paymentProviderLabel(signals);
    const checkoutEvidence = [
      ...(signals.paymentProviders.length > 0
        ? signals.paymentProviders.map((name) =>
            businessDiscoveryEvidence("payment_provider", `Provider: ${name}`, 0.9)
          )
        : [
            businessDiscoveryEvidence(
              "attack_surface",
              "Payments surface detected without named provider",
              0.75
            ),
          ]),
      ...(signals.billingRouteHints.length > 0
        ? signals.billingRouteHints.map((path) =>
            businessDiscoveryEvidence("api_inventory", `Billing-related route: ${path}`, 0.82)
          )
        : []),
    ];
    const confidence =
      checkoutEvidence.length > 0
        ? Math.min(0.95, Math.max(...checkoutEvidence.map((e) => e.confidence)))
        : 0;
    if (confidence >= MIN_WORKFLOW_CONFIDENCE) {
      workflows.push({
        id: randomUUID(),
        kind: "payment_checkout",
        label: "Payment checkout",
        businessObjective: `Collect payment from customer via ${provider} without granting value before confirmed settlement.`,
        confidence,
        evidence: checkoutEvidence,
        actors: [
          actor("customer", "Authenticated or guest customer", [
            businessDiscoveryEvidence(
              signals.hasAuthentication ? "authentication" : "discovery_report",
              signals.hasAuthentication
                ? "Checkout typically bound to authenticated account"
                : "Checkout may allow guest payer",
              signals.hasAuthentication ? 0.8 : 0.55
            ),
          ]),
          actor("system", "Application billing service", [
            businessDiscoveryEvidence("discovery_report", "Application orchestrates checkout server-side", 0.75),
          ]),
        ],
        resources: [
          resource("payment", "Payment intent or charge", checkoutEvidence),
          resource("order", "Order or entitlement record", [
            businessDiscoveryEvidence(
              "discovery_report",
              "Fulfillment usually depends on an order or entitlement record",
              0.7
            ),
          ]),
        ],
      });
    }
  }

  if (
    hasPaymentStack(signals) &&
    (signals.hasWebhooksSurface || signals.webhookEndpoints.length > 0)
  ) {
    const webhookEvidence = [
      ...(signals.webhookEndpoints.length > 0
        ? signals.webhookEndpoints.map((path) =>
            businessDiscoveryEvidence("api_inventory", `Webhook endpoint: ${path}`, 0.9)
          )
        : [
            businessDiscoveryEvidence("attack_surface", "Webhook surface in discovery", 0.78),
          ]),
      businessDiscoveryEvidence(
        "payment_provider",
        "Payment providers rely on signed webhook events for settlement truth",
        0.85
      ),
    ];
    const confidence =
      webhookEvidence.length > 0
        ? Math.min(0.94, Math.max(...webhookEvidence.map((e) => e.confidence)))
        : 0;
    if (confidence >= MIN_WORKFLOW_CONFIDENCE) {
      workflows.push({
        id: randomUUID(),
        kind: "payment_webhook_settlement",
        label: "Webhook settlement",
        businessObjective:
          "Apply payment state only from verified provider webhook events; prevent replay and duplicate entitlement grants.",
        confidence,
        evidence: webhookEvidence,
        actors: [
          actor("webhook_processor", "Webhook handler", webhookEvidence),
          actor("system", "Entitlement service", [
            businessDiscoveryEvidence(
              "discovery_report",
              "Downstream entitlements often updated after webhook processing",
              0.72
            ),
          ]),
        ],
        resources: [
          resource("webhook_event", "Provider webhook payload", webhookEvidence),
          resource("subscription", "Subscription or access grant", [
            businessDiscoveryEvidence(
              "payment_provider",
              "Settlement events typically unlock subscription state",
              0.78
            ),
          ]),
        ],
      });
    }
  }

  if (hasPaymentStack(signals) && signals.hasAuthentication) {
    const subEvidence = [
      businessDiscoveryEvidence("payment_provider", "Billing stack present", 0.85),
      businessDiscoveryEvidence("authentication", "Account binding for subscription state", 0.88),
      ...(signals.summaryHints.subscriptions
        ? [
            businessDiscoveryEvidence(
              "project_summary",
              "Summary references subscriptions or trials",
              0.85
            ),
          ]
        : []),
    ];
    const confidence = signals.summaryHints.subscriptions ? 0.86 : 0.72;
    if (confidence >= MIN_WORKFLOW_CONFIDENCE) {
      workflows.push({
        id: randomUUID(),
        kind: "subscription_lifecycle",
        label: "Subscription lifecycle",
        businessObjective:
          "Move accounts through trial, active, past-due, and canceled states without skipping payment or reusing trials.",
        confidence,
        evidence: subEvidence,
        actors: [
          actor("customer", "Subscriber", subEvidence),
          actor("system", "Billing scheduler", [
            businessDiscoveryEvidence("discovery_report", "Lifecycle transitions enforced server-side", 0.7),
          ]),
        ],
        resources: [
          resource("subscription", "Subscription record", subEvidence),
          resource("user_account", "Subscriber account", [
            businessDiscoveryEvidence("authentication", "Subscription tied to user identity", 0.85),
          ]),
        ],
      });
    }
  }

  if (signals.summaryHints.credits && (hasPaymentStack(signals) || discovery.aiProviders.length > 0)) {
    const creditEvidence = [
      businessDiscoveryEvidence("project_summary", "Credits or metered usage referenced", 0.68),
      ...(discovery.aiProviders.length > 0
        ? [
            businessDiscoveryEvidence(
              "discovery_report",
              `AI provider ${discovery.aiProviders[0]?.name ?? ""} suggests metered consumption`,
              0.65
            ),
          ]
        : []),
    ];
    const confidence = 0.68;
    if (confidence >= MIN_WORKFLOW_CONFIDENCE) {
      workflows.push({
        id: randomUUID(),
        kind: "credit_quota",
        label: "Credits and quotas",
        businessObjective:
          "Decrement credits and enforce quotas atomically; prevent concurrent overspend or negative balances.",
        confidence,
        evidence: creditEvidence,
        actors: [actor("customer", "Consuming user", creditEvidence)],
        resources: [
          resource("credit_balance", "Credit balance", creditEvidence),
          resource("quota", "Usage quota", creditEvidence),
        ],
      });
    }
  }

  if (signals.summaryHints.coupons && hasPaymentStack(signals)) {
    const couponEvidence = [
      businessDiscoveryEvidence("project_summary", "Coupons or promotions referenced", 0.72),
      businessDiscoveryEvidence("payment_provider", "Coupons applied during checkout or billing", 0.7),
    ];
    if (0.72 >= MIN_WORKFLOW_CONFIDENCE) {
      workflows.push({
        id: randomUUID(),
        kind: "coupon_redemption",
        label: "Coupon redemption",
        businessObjective: "Each coupon or promo code should redeem once per intended policy window.",
        confidence: 0.72,
        evidence: couponEvidence,
        actors: [actor("customer", "Redeeming customer", couponEvidence)],
        resources: [resource("coupon", "Coupon code", couponEvidence), resource("payment", "Discounted charge", couponEvidence)],
      });
    }
  }

  if (signals.summaryHints.invitations && signals.hasAuthentication) {
    const inviteEvidence = [
      businessDiscoveryEvidence("project_summary", "Invitations or referrals referenced", 0.7),
      businessDiscoveryEvidence("authentication", "Invite flows require accounts", 0.72),
    ];
    if (0.7 >= MIN_WORKFLOW_CONFIDENCE) {
      workflows.push({
        id: randomUUID(),
        kind: "invitation_referral",
        label: "Invitation and referral",
        businessObjective:
          "Issue referral rewards once per valid invitation; prevent self-referral and replayed invite links.",
        confidence: 0.7,
        evidence: inviteEvidence,
        actors: [
          actor("customer", "Inviter", inviteEvidence),
          actor("customer", "Invitee", inviteEvidence),
        ],
        resources: [
          resource("invitation", "Invitation token", inviteEvidence),
          resource("user_account", "Invitee account", inviteEvidence),
        ],
      });
    }
  }

  if (signals.hasAdminArea) {
    const adminEvidence = [
      businessDiscoveryEvidence("attack_surface", "Admin area present in discovery", 0.8),
    ];
    if (0.8 >= MIN_WORKFLOW_CONFIDENCE) {
      workflows.push({
        id: randomUUID(),
        kind: "admin_business_operations",
        label: "Admin business operations",
        businessObjective:
          "Restrict high-impact business actions (refunds, credits, plan overrides) to authorized staff with audit trails.",
        confidence: 0.8,
        evidence: adminEvidence,
        actors: [actor("admin", "Staff administrator", adminEvidence)],
        resources: [resource("admin_config", "Business configuration", adminEvidence)],
      });
    }
  }

  return {
    signals,
    entities,
    workflows: dedupeWorkflowsByKind(workflows),
  };
}

function dedupeWorkflowsByKind(workflows: DiscoveredBusinessWorkflow[]): DiscoveredBusinessWorkflow[] {
  const byKind = new Map<string, DiscoveredBusinessWorkflow>();
  for (const workflow of workflows) {
    const existing = byKind.get(workflow.kind);
    if (!existing || workflow.confidence > existing.confidence) {
      byKind.set(workflow.kind, workflow);
    }
  }
  return [...byKind.values()].sort((a, b) => b.confidence - a.confidence);
}
