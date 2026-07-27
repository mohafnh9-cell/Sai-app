import { randomUUID } from "node:crypto";
import type {
  AbuseStrategy,
  AbuseStrategyContext,
  BusinessAbuseCase,
  BusinessAbuseCategory,
} from "./abuse.types";
import type { BusinessInvariantCategory } from "../invariants/invariant.types";
import {
  buildSequenceFromTransition,
  invariantEvidenceToAbuse,
  primaryActorRole,
  severityForCategory,
} from "./abuse-generator";
import { abuseConfidenceFromInvariant, maxEvidenceConfidence } from "./abuse-confidence";

function strategy(
  id: string,
  categories: BusinessInvariantCategory[],
  fn: (ctx: AbuseStrategyContext) => BusinessAbuseCase[]
): AbuseStrategy {
  return { id, invariantCategories: categories, generate: fn };
}

function baseCase(
  ctx: AbuseStrategyContext,
  input: {
    abuseKeySuffix: string;
    category: BusinessAbuseCategory;
    title: string;
    description: string;
    sequence: BusinessAbuseCase["sequence"];
    expectedOutcome: string;
    mitigationHints: string[];
    assumptions?: BusinessAbuseCase["assumptions"];
  }
): BusinessAbuseCase {
  const evidence = invariantEvidenceToAbuse(ctx.invariant, ctx.workflow);
  const evidenceMax = maxEvidenceConfidence([
    ...evidence,
    ...ctx.invariant.evidence,
  ]);
  const confidence = abuseConfidenceFromInvariant(ctx.invariant.confidence, evidenceMax);
  if (confidence === "unsupported") {
    return null as unknown as BusinessAbuseCase;
  }

  const actorRole = primaryActorRole(ctx.workflow);

  return {
    id: randomUUID(),
    abuseKey: `${ctx.invariant.invariantKey}:abuse:${input.abuseKeySuffix}`,
    title: input.title,
    description: input.description,
    category: input.category,
    severity: severityForCategory(input.category),
    confidence,
    targetInvariantId: ctx.invariant.id,
    targetInvariantKey: ctx.invariant.invariantKey,
    targetWorkflowId: ctx.workflow.id,
    targetWorkflowKind: ctx.workflow.kind,
    targetStateMachineId: ctx.machine.id,
    targetEntityIds: ctx.invariant.entityIds,
    targetStateIds: input.sequence.steps.map((s) => s.stateId),
    actorRole,
    sequence: input.sequence,
    businessImpact: ctx.invariant.potentialImpact,
    affectedValueKind: ctx.invariant.protectedValueKind,
    evidence,
    assumptions: input.assumptions ?? [],
    expectedOutcome: input.expectedOutcome,
    mitigationHints: input.mitigationHints,
  };
}

function findTransition(machine: AbuseStrategyContext["machine"], event: string) {
  return machine.transitions.find((t) => t.event === event) ?? machine.transitions[0];
}

export const defaultAbuseStrategies: AbuseStrategy[] = [
  strategy("ordering-invalid", ["ordering"], (ctx) => {
    const happy = ctx.machine.metadata.tags.find((t) => t.startsWith("happy_path:"));
    const segments = happy?.replace("happy_path:", "").split(">") ?? [];
    if (segments.length < 3) return [];

    const skipTarget = segments[2]!;
    const transition =
      ctx.machine.transitions.find((t) => t.toStateId === skipTarget) ??
      findTransition(ctx.machine, "grant_entitlement");
    if (!transition) return [];

    const sequence = buildSequenceFromTransition({
      machine: ctx.machine,
      transition,
      priorStateId: segments[0]!,
      actorRole: primaryActorRole(ctx.workflow),
      actionKind: "invoke_event",
      actionLabel: "Trigger downstream transition before prerequisites complete",
      invariantViolationSummary: ctx.invariant.title,
      businessConsequence: "Business value granted without satisfying ordering invariant.",
    });

    const abuse = baseCase(ctx, {
      abuseKeySuffix: "invalid_ordering",
      category: "invalid_ordering",
      title: "Skip prerequisite workflow states",
      description:
        "Invoke a downstream transition from an earlier state without completing required intermediate steps.",
      sequence,
      expectedOutcome: "Downstream state reached while ordering invariant is violated.",
      mitigationHints: [
        "Enforce server-side state guards on every transition.",
        "Reject events when current state does not match handler expectations.",
      ],
      assumptions: [{ id: randomUUID(), statement: "Attacker can call backend handlers directly.", required: true }],
    });
    return abuse ? [abuse] : [];
  }),

  strategy("idempotency-duplicate", ["idempotency"], (ctx) => {
    const transition = ctx.machine.transitions.find((t) => t.retryPolicy === "idempotent_retry") ??
      ctx.machine.transitions[0];
    if (!transition) return [];

    const sequence = buildSequenceFromTransition({
      machine: ctx.machine,
      transition,
      actorRole: primaryActorRole(ctx.workflow),
      actionKind: "repeat_request",
      actionLabel: "Repeat the same successful request or webhook delivery",
      invariantViolationSummary: ctx.invariant.title,
      businessConsequence: "Duplicate economic or entitlement effect if idempotency fails.",
    });
    sequence.steps.push({
      order: sequence.steps.length + 1,
      stateId: transition.toStateId,
      stateName: ctx.machine.states.find((s) => s.id === transition.toStateId)?.name ?? transition.toStateId,
      action: {
        id: randomUUID(),
        kind: "repeat_request",
        label: "Replay identical event",
        event: transition.event,
        actorRole: primaryActorRole(ctx.workflow),
      },
      transitionId: transition.id,
      transitionEvent: transition.event,
      toStateId: transition.toStateId,
      toStateName: transition.toStateId,
      note: "Second application should be neutralized",
    });

    const abuse = baseCase(ctx, {
      abuseKeySuffix: "duplicate_execution",
      category: "duplicate_execution",
      title: "Duplicate execution of idempotent path",
      description: "Repeat the same event delivery to test missing idempotency keys.",
      sequence,
      expectedOutcome: "Second execution applies business effect twice.",
      mitigationHints: ["Persist processed event identifiers.", "Use idempotency keys on mutating handlers."],
    });
    return abuse ? [abuse] : [];
  }),

  strategy("cross-workflow", ["cross_workflow_consistency"], (ctx) => {
    const fulfill = ctx.machine.transitions.find((t) => t.event === "grant_entitlement");
    if (!fulfill) return [];

    const sequence = buildSequenceFromTransition({
      machine: ctx.machine,
      transition: fulfill,
      priorStateId: ctx.machine.initialStateId,
      actorRole: primaryActorRole(ctx.workflow),
      actionKind: "invoke_event",
      actionLabel: "Grant entitlement before settlement channel confirms payment",
      invariantViolationSummary: ctx.invariant.title,
      businessConsequence: "Customer receives product without durable settlement alignment.",
    });

    const abuse = baseCase(ctx, {
      abuseKeySuffix: "cross_workflow",
      category: "cross_workflow_abuse",
      title: "Fulfillment before settlement alignment",
      description:
        "Complete checkout fulfillment without waiting for webhook or settlement workflow confirmation.",
      sequence,
      expectedOutcome: "Entitlement active while settlement workflow lags or fails.",
      mitigationHints: [
        "Gate fulfillment on confirmed settlement record shared across workflows.",
      ],
    });
    return abuse ? [abuse] : [];
  }),

  strategy("webhook-replay", ["webhook_ordering"], (ctx) => {
    const apply = ctx.machine.transitions.find((t) => t.event === "apply_settlement");
    const verify = ctx.machine.transitions.find((t) => t.event === "verify_signature");
    const transition = apply ?? verify ?? ctx.machine.transitions[0];
    if (!transition) return [];

    const sequence = buildSequenceFromTransition({
      machine: ctx.machine,
      transition,
      actorRole: "webhook_processor",
      actionKind: "repeat_request",
      actionLabel: "Deliver the same webhook payload twice",
      invariantViolationSummary: ctx.invariant.title,
      businessConsequence: "Duplicate settlement application.",
    });

    const abuse = baseCase(ctx, {
      abuseKeySuffix: "webhook_replay",
      category: "webhook_replay",
      title: "Webhook replay",
      description: "Replay a valid webhook to trigger duplicate settlement or entitlement updates.",
      sequence,
      expectedOutcome: "Second delivery mutates business state again.",
      mitigationHints: ["Store provider event IDs uniquely.", "Verify-before-apply ordering enforced in code path."],
    });
    return abuse ? [abuse] : [];
  }),

  strategy("concurrency-race", ["concurrency"], (ctx) => {
    const consume = ctx.machine.transitions.find((t) => t.event === "begin_consume") ?? ctx.machine.transitions[0];
    if (!consume) return [];

    const sequence = buildSequenceFromTransition({
      machine: ctx.machine,
      transition: consume,
      actorRole: primaryActorRole(ctx.workflow),
      actionKind: "parallel_request",
      actionLabel: "Issue parallel consume requests against the same balance",
      invariantViolationSummary: ctx.invariant.title,
      businessConsequence: "Balance or quota driven negative under concurrency.",
    });

    const abuse = baseCase(ctx, {
      abuseKeySuffix: "race_condition",
      category: "race_condition",
      title: "Concurrent quota or credit consumption",
      description: "Parallel requests race on non-atomic debit logic.",
      sequence,
      expectedOutcome: "Aggregate consumption exceeds intended quota or credit envelope.",
      mitigationHints: ["Use transactional debit with row-level locking or compare-and-set."],
    });
    return abuse ? [abuse] : [];
  }),

  strategy("coupon-replay", ["coupon_lifecycle"], (ctx) => {
    const redeem = ctx.machine.transitions.find((t) => t.event === "apply_coupon") ?? ctx.machine.transitions[0];
    if (!redeem) return [];

    const sequence = buildSequenceFromTransition({
      machine: ctx.machine,
      transition: redeem,
      actorRole: primaryActorRole(ctx.workflow),
      actionKind: "repeat_request",
      actionLabel: "Redeem the same coupon code again",
      invariantViolationSummary: ctx.invariant.title,
      businessConsequence: "Promotional value applied more than once.",
    });

    const abuse = baseCase(ctx, {
      abuseKeySuffix: "coupon_replay",
      category: "coupon_replay",
      title: "Coupon replay",
      description: "Reuse a single-use coupon across checkout attempts.",
      sequence,
      expectedOutcome: "Multiple discounts or benefits from one coupon.",
      mitigationHints: ["Bind coupon redemption to account and persist redeemed state atomically."],
    });
    return abuse ? [abuse] : [];
  }),

  strategy("invitation-abuse", ["invitation_lifecycle"], (ctx) => {
    const reward = ctx.machine.transitions.find((t) => t.event === "grant_reward") ?? ctx.machine.transitions[0];
    if (!reward) return [];

    const sequence = buildSequenceFromTransition({
      machine: ctx.machine,
      transition: reward,
      actorRole: primaryActorRole(ctx.workflow),
      actionKind: "invoke_event",
      actionLabel: "Claim referral reward with manipulated invite pairing",
      invariantViolationSummary: ctx.invariant.title,
      businessConsequence: "Referral incentives paid without valid acquisition.",
    });

    const abuse = baseCase(ctx, {
      abuseKeySuffix: "reward_farming",
      category: "reward_farming",
      title: "Referral reward farming",
      description: "Self-refer or replay invite acceptance to harvest rewards.",
      sequence,
      expectedOutcome: "Rewards issued for fraudulent invite pairs.",
      mitigationHints: ["Detect self-referral and cap rewards per inviter."],
      assumptions: [{ id: randomUUID(), statement: "Attacker controls multiple accounts.", required: true }],
    });
    return abuse ? [abuse] : [];
  }),

  strategy("subscription-trial", ["subscription_lifecycle"], (ctx) => {
    const trial = ctx.machine.transitions.find((t) => t.event === "start_trial");
    if (!trial) return [];

    const sequence = buildSequenceFromTransition({
      machine: ctx.machine,
      transition: trial,
      actorRole: primaryActorRole(ctx.workflow),
      actionKind: "repeat_request",
      actionLabel: "Start trial again after expiration",
      invariantViolationSummary: ctx.invariant.title,
      businessConsequence: "Repeated trial access without payment.",
    });

    const abuse = baseCase(ctx, {
      abuseKeySuffix: "trial_replay",
      category: "trial_replay",
      title: "Trial replay",
      description: "Obtain another trial period by re-registering or resetting trial flags.",
      sequence,
      expectedOutcome: "Extended access without converting to paid subscription.",
      mitigationHints: ["Persist trial consumption per identity fingerprint."],
    });
    return abuse ? [abuse] : [];
  }),

  strategy("payment-double", ["payment_lifecycle"], (ctx) => {
    const charge = ctx.machine.transitions.find((t) => t.economicEffect === "charge") ??
      ctx.machine.transitions.find((t) => t.event === "provider_confirmed");
    if (!charge) return [];

    const sequence = buildSequenceFromTransition({
      machine: ctx.machine,
      transition: charge,
      actorRole: primaryActorRole(ctx.workflow),
      actionKind: "invoke_event",
      actionLabel: "Confirm payment without provider settlement",
      invariantViolationSummary: ctx.invariant.title,
      businessConsequence: "Goods delivered while payment fails or is reversed.",
    });

    const abuse = baseCase(ctx, {
      abuseKeySuffix: "double_spend",
      category: "double_spend",
      title: "Payment confirmation without settlement",
      description: "Advance payment state locally without provider-confirmed funds.",
      sequence,
      expectedOutcome: "Business accepts economic loss or chargeback exposure.",
      mitigationHints: ["Treat provider webhook or synchronous confirmation as source of truth."],
    });
    return abuse ? [abuse] : [];
  }),

  strategy("rollback-abuse", ["retry_safety"], (ctx) => {
    const rollback = ctx.machine.transitions.find((t) => t.rollbackTargetStateId);
    if (!rollback) return [];

    const sequence = buildSequenceFromTransition({
      machine: ctx.machine,
      transition: rollback,
      actorRole: primaryActorRole(ctx.workflow),
      actionKind: "rollback_trigger",
      actionLabel: "Trigger rollback without compensating side effects",
      invariantViolationSummary: ctx.invariant.title,
      businessConsequence: "Inconsistent ledger vs entitlement after partial rollback.",
    });

    const abuse = baseCase(ctx, {
      abuseKeySuffix: "rollback_abuse",
      category: "rollback_abuse",
      title: "Incomplete compensating rollback",
      description: "Rollback workflow state while leaving entitlements or balances updated.",
      sequence,
      expectedOutcome: "Split-brain between payment and fulfillment records.",
      mitigationHints: ["Make rollback transitions atomic with entitlement reversal."],
    });
    return abuse ? [abuse] : [];
  }),

  strategy("entitlement-assumption", ["entitlement_consistency"], (ctx) => {
    const abuse = baseCase(ctx, {
      abuseKeySuffix: "entitlement_abuse",
      category: "entitlement_abuse",
      title: "Entitlement scope mismatch",
      description:
        "Apply entitlements to a session or account that does not match authenticated identity binding.",
      sequence: {
        id: randomUUID(),
        steps: [
          {
            order: 1,
            stateId: ctx.machine.initialStateId,
            stateName: ctx.machine.states.find((s) => s.id === ctx.machine.initialStateId)?.name ?? "initial",
            action: {
              id: randomUUID(),
              kind: "out_of_band",
              label: "Use valid token against another account resource",
              event: null,
              actorRole: primaryActorRole(ctx.workflow),
            },
            transitionId: null,
            transitionEvent: null,
            toStateId: null,
            toStateName: null,
            note: "Cross-account entitlement application",
          },
        ],
        invariantViolationSummary: ctx.invariant.title,
        businessConsequence: "Access granted outside intended account boundary.",
      },
      expectedOutcome: "Entitlement applied to wrong principal while requests remain authenticated.",
      mitigationHints: ["Bind entitlements to subject ID from verified session on every mutation."],
      assumptions: ctx.invariant.assumptions.map((s, i) => ({
        id: randomUUID(),
        statement: s,
        required: i === 0,
      })),
    });
    return abuse ? [abuse] : [];
  }),

  strategy("ownership-cross-tenant", ["ownership"], (ctx) => {
    if (ctx.invariant.confidence === "assumed") return [];
    const abuse = baseCase(ctx, {
      abuseKeySuffix: "cross_tenant",
      category: "cross_tenant_abuse",
      title: "Cross-tenant resource manipulation",
      description:
        "Mutate a business entity while authenticated as a different owner than the resource record expects.",
      sequence: {
        id: randomUUID(),
        steps: [
          {
            order: 1,
            stateId: ctx.machine.initialStateId,
            stateName: "initial",
            action: {
              id: randomUUID(),
              kind: "out_of_band",
              label: "Reference foreign entity identifier in mutating request",
              event: null,
              actorRole: primaryActorRole(ctx.workflow),
            },
            transitionId: null,
            transitionEvent: null,
            toStateId: null,
            toStateName: null,
            note: "Ownership invariant stress — not endpoint authorization test",
          },
        ],
        invariantViolationSummary: ctx.invariant.title,
        businessConsequence: "Business entity operated outside intended owner scope.",
      },
      expectedOutcome: "Resource state reflects another tenant or user ownership.",
      mitigationHints: ["Resolve ownership from server-side record, never from client-supplied IDs alone."],
    });
    return abuse ? [abuse] : [];
  }),
];
