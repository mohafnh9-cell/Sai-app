import { randomUUID } from "node:crypto";
import type { DiscoveredBusinessWorkflow, DiscoveredBusinessWorkflowKind } from "../discovery/discovery.types";
import type {
  BusinessState,
  BusinessStateMachine,
  BusinessTransition,
  EconomicEffect,
  SideEffectKind,
} from "./domain.types";
import { buildMetadata } from "./evidence";

type FsmTemplate = {
  states: Array<{ id: string; name: string; kind: BusinessState["kind"]; description: string }>;
  transitions: Array<{
    from: string;
    to: string;
    event: string;
    guard?: string | null;
    rollback?: string | null;
    retry?: BusinessTransition["retryPolicy"];
    economic?: EconomicEffect;
    sideEffects?: SideEffectKind[];
    entry?: string[];
    exit?: string[];
  }>;
  orderingHints: string[];
};

const TEMPLATES: Record<DiscoveredBusinessWorkflowKind, FsmTemplate> = {
  payment_checkout: {
    states: [
      { id: "initiated", name: "Initiated", kind: "initial", description: "Checkout session created" },
      { id: "payment_pending", name: "Payment pending", kind: "normal", description: "Awaiting provider confirmation" },
      { id: "payment_confirmed", name: "Payment confirmed", kind: "normal", description: "Provider confirmed settlement" },
      { id: "fulfilled", name: "Fulfilled", kind: "terminal", description: "Entitlement or order delivered" },
      { id: "cancelled", name: "Cancelled", kind: "terminal", description: "Checkout abandoned or voided" },
      { id: "failed", name: "Failed", kind: "error", description: "Payment failed" },
    ],
    transitions: [
      { from: "initiated", to: "payment_pending", event: "submit_payment", guard: "valid_checkout", economic: "none", sideEffects: ["external_call"] },
      { from: "payment_pending", to: "payment_confirmed", event: "provider_confirmed", guard: "settlement_verified", economic: "charge", sideEffects: ["persist"] },
      { from: "payment_pending", to: "failed", event: "provider_failed", guard: null, economic: "none" },
      { from: "payment_pending", to: "cancelled", event: "cancel", guard: null, rollback: "initiated", retry: "none" },
      { from: "payment_confirmed", to: "fulfilled", event: "grant_entitlement", guard: "idempotent_fulfillment", economic: "grant_access", sideEffects: ["persist", "notify"] },
      { from: "payment_confirmed", to: "cancelled", event: "rollback_checkout", guard: "refund_required", rollback: "payment_pending", economic: "refund" },
    ],
    orderingHints: ["initiated", "payment_pending", "payment_confirmed", "fulfilled"],
  },
  payment_webhook_settlement: {
    states: [
      { id: "received", name: "Received", kind: "initial", description: "Webhook payload accepted" },
      { id: "verified", name: "Verified", kind: "normal", description: "Signature and schema validated" },
      { id: "applied", name: "Applied", kind: "terminal", description: "Business state updated" },
      { id: "duplicate_rejected", name: "Duplicate rejected", kind: "terminal", description: "Idempotent skip" },
      { id: "failed", name: "Failed", kind: "error", description: "Processing error" },
    ],
    transitions: [
      { from: "received", to: "verified", event: "verify_signature", guard: "valid_signature", sideEffects: ["persist"] },
      { from: "received", to: "failed", event: "reject", guard: "invalid_signature" },
      { from: "verified", to: "applied", event: "apply_settlement", guard: "first_occurrence", economic: "grant_access", retry: "idempotent_retry", sideEffects: ["persist", "emit_event"] },
      { from: "verified", to: "duplicate_rejected", event: "detect_duplicate", guard: "event_id_seen", retry: "idempotent_retry" },
      { from: "verified", to: "failed", event: "apply_error", guard: null, retry: "manual_retry" },
    ],
    orderingHints: ["received", "verified", "applied"],
  },
  subscription_lifecycle: {
    states: [
      { id: "none", name: "No subscription", kind: "initial", description: "Account without active plan" },
      { id: "trialing", name: "Trialing", kind: "normal", description: "Trial period active" },
      { id: "active", name: "Active", kind: "normal", description: "Paid subscription active" },
      { id: "past_due", name: "Past due", kind: "normal", description: "Payment overdue" },
      { id: "canceled", name: "Canceled", kind: "terminal", description: "Subscription ended" },
      { id: "expired", name: "Expired", kind: "terminal", description: "Trial or term ended without conversion" },
    ],
    transitions: [
      { from: "none", to: "trialing", event: "start_trial", guard: "trial_available", economic: "grant_access" },
      { from: "none", to: "active", event: "subscribe", guard: "payment_method_valid", economic: "charge" },
      { from: "trialing", to: "active", event: "convert_trial", guard: "payment_success", economic: "charge" },
      { from: "trialing", to: "expired", event: "trial_end", guard: "no_conversion", economic: "revoke_access" },
      { from: "active", to: "past_due", event: "payment_failed", guard: null },
      { from: "past_due", to: "active", event: "payment_recovered", guard: "payment_success", retry: "idempotent_retry" },
      { from: "active", to: "canceled", event: "cancel", guard: "authorized_cancel", economic: "revoke_access" },
      { from: "past_due", to: "canceled", event: "cancel_for_nonpayment", guard: null, economic: "revoke_access" },
    ],
    orderingHints: ["none", "trialing", "active", "canceled"],
  },
  credit_quota: {
    states: [
      { id: "available", name: "Credits available", kind: "initial", description: "Balance above zero" },
      { id: "consuming", name: "Consuming", kind: "normal", description: "Debit in progress" },
      { id: "depleted", name: "Depleted", kind: "terminal", description: "No credits remain" },
      { id: "blocked", name: "Blocked", kind: "error", description: "Quota enforcement error" },
    ],
    transitions: [
      { from: "available", to: "consuming", event: "begin_consume", guard: "sufficient_balance", economic: "consume_credit", retry: "idempotent_retry" },
      { from: "consuming", to: "available", event: "commit_consume", guard: "atomic_debit", sideEffects: ["persist"] },
      { from: "consuming", to: "depleted", event: "commit_consume", guard: "balance_zero", economic: "consume_credit" },
      { from: "consuming", to: "blocked", event: "race_detected", guard: "concurrency_conflict" },
      { from: "available", to: "blocked", event: "quota_exceeded", guard: "over_limit" },
    ],
    orderingHints: ["available", "consuming", "depleted"],
  },
  coupon_redemption: {
    states: [
      { id: "issued", name: "Issued", kind: "initial", description: "Coupon valid for redemption" },
      { id: "redeemed", name: "Redeemed", kind: "terminal", description: "Coupon consumed" },
      { id: "rejected", name: "Rejected", kind: "terminal", description: "Invalid or expired coupon" },
    ],
    transitions: [
      { from: "issued", to: "redeemed", event: "apply_coupon", guard: "single_use_ok", economic: "charge", retry: "idempotent_retry" },
      { from: "issued", to: "rejected", event: "reject_coupon", guard: "expired_or_used" },
    ],
    orderingHints: ["issued", "redeemed"],
  },
  invitation_referral: {
    states: [
      { id: "created", name: "Created", kind: "initial", description: "Invitation issued" },
      { id: "accepted", name: "Accepted", kind: "normal", description: "Invitee registered" },
      { id: "rewarded", name: "Rewarded", kind: "terminal", description: "Referral benefit applied" },
      { id: "abused", name: "Abused", kind: "error", description: "Self-referral or replay detected" },
    ],
    transitions: [
      { from: "created", to: "accepted", event: "accept_invite", guard: "unique_invitee" },
      { from: "accepted", to: "rewarded", event: "grant_reward", guard: "one_reward_per_pair", economic: "grant_access", sideEffects: ["persist"] },
      { from: "created", to: "abused", event: "detect_abuse", guard: "self_referral" },
      { from: "accepted", to: "abused", event: "detect_replay", guard: "duplicate_accept" },
    ],
    orderingHints: ["created", "accepted", "rewarded"],
  },
  admin_business_operations: {
    states: [
      { id: "requested", name: "Requested", kind: "initial", description: "Admin action requested" },
      { id: "authorized", name: "Authorized", kind: "normal", description: "Staff authorization verified" },
      { id: "applied", name: "Applied", kind: "terminal", description: "Business change applied" },
      { id: "denied", name: "Denied", kind: "terminal", description: "Action rejected" },
    ],
    transitions: [
      { from: "requested", to: "authorized", event: "verify_staff", guard: "admin_role", sideEffects: ["persist"] },
      { from: "requested", to: "denied", event: "deny", guard: "insufficient_role" },
      { from: "authorized", to: "applied", event: "apply_change", guard: "audit_logged", sideEffects: ["persist", "notify"] },
      { from: "authorized", to: "denied", event: "policy_block", guard: "policy_violation" },
    ],
    orderingHints: ["requested", "authorized", "applied"],
  },
};

export function buildStateMachineForWorkflow(
  discovered: DiscoveredBusinessWorkflow,
  ownerActorId: string | null
): BusinessStateMachine {
  const template = TEMPLATES[discovered.kind];
  const machineId = randomUUID();
  const meta = buildMetadata({
    discoveredWorkflowId: discovered.id,
    discoveredWorkflowKind: discovered.kind,
    evidence: discovered.evidence,
    tags: ["fsm", discovered.kind],
  });

  const states: BusinessState[] = template.states.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    description: s.description,
    ownerActorId: s.kind === "initial" || s.kind === "normal" ? ownerActorId : ownerActorId,
    metadata: meta,
  }));

  const transitions: BusinessTransition[] = template.transitions.map((t) => ({
    id: randomUUID(),
    fromStateId: t.from,
    toStateId: t.to,
    event: t.event,
    guard: t.guard ?? null,
    actorId: ownerActorId,
    entryActions: t.entry ?? [],
    exitActions: t.exit ?? [],
    rollbackTargetStateId: t.rollback ?? null,
    retryPolicy: t.retry ?? "none",
    economicEffect: t.economic ?? "none",
    sideEffects: t.sideEffects ?? [],
    metadata: meta,
  }));

  const initial = states.find((s) => s.kind === "initial")!;
  const terminalStateIds = states.filter((s) => s.kind === "terminal").map((s) => s.id);
  const errorStateIds = states.filter((s) => s.kind === "error").map((s) => s.id);

  return {
    id: machineId,
    workflowId: discovered.id,
    label: `${discovered.label} FSM`,
    initialStateId: initial.id,
    states,
    transitions,
    terminalStateIds,
    errorStateIds,
    metadata: meta,
  };
}

export function primaryHappyPathStateIds(discoveredKind: DiscoveredBusinessWorkflowKind): string[] {
  return TEMPLATES[discoveredKind].orderingHints;
}

export function stateLabelMap(machine: BusinessStateMachine): Map<string, string> {
  return new Map(machine.states.map((s) => [s.id, s.name]));
}
