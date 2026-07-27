import { randomUUID } from "node:crypto";
import type {
  BusinessConstraint,
  BusinessEntity,
  BusinessStateMachine,
  BusinessTransition,
  BusinessWorkflow,
} from "../model/domain.types";
import type { BusinessDiscoverySignals } from "../discovery/discovery.types";
import type { InvariantExtractionInput } from "./invariant.types";
import {
  type BusinessInvariant,
  type BusinessInvariantCategory,
  type BusinessInvariantCollection,
  type BusinessInvariantEvidence,
  type BusinessInvariantGroup,
  type BusinessInvariantSource,
} from "./invariant.types";
import { classifyConfidence, mergeInvariantEvidence } from "./invariant-confidence";
import { validateInvariantCollection } from "./invariant-validator";

export function extractBusinessInvariants(input: InvariantExtractionInput): BusinessInvariantCollection {
  const invariants: BusinessInvariant[] = [];

  for (const workflow of input.domain.workflows) {
    const machine = input.domain.stateMachines.find((m) => m.id === workflow.stateMachineId);
    if (!machine) continue;

    const entityIds = workflow.resources
      .map((r) => r.linkedEntityId)
      .filter((id): id is string => Boolean(id));
    const actorIds = workflow.actors.map((a) => a.id);
    const discoveryMax = maxEvidenceConfidence(workflow.metadata.evidence);

    for (const constraint of workflow.constraints) {
      invariants.push(
        invariantFromConstraint(workflow, machine, constraint, entityIds, actorIds, discoveryMax)
      );
    }

    invariants.push(...orderingInvariants(workflow, machine, entityIds, actorIds, discoveryMax));
    invariants.push(...idempotencyInvariants(workflow, machine, entityIds, actorIds, discoveryMax));
    invariants.push(...rollbackInvariants(workflow, machine, entityIds, actorIds, discoveryMax));
    invariants.push(...ownershipInvariants(workflow, machine, input.domain.entities, actorIds, discoveryMax));
    invariants.push(...lifecycleInvariants(workflow, machine, entityIds, actorIds, discoveryMax));
    invariants.push(...categorySpecificInvariants(workflow, machine, entityIds, actorIds, discoveryMax));
  }

  invariants.push(...crossWorkflowInvariants(input.domain.workflows, input.domain.stateMachines));

  if (input.discoverySignals.hasAuthentication) {
    invariants.push(
      authenticationAssumptionInvariant(input.domain.workflows, input.discoverySignals, input.domain.stateMachines)
    );
  }
  if (input.discoverySignals.hasAdminArea) {
    invariants.push(
      authorizationAssumptionInvariant(input.domain.workflows, input.discoverySignals, input.domain.stateMachines)
    );
  }

  const filtered = dedupeInvariants(invariants.filter((i) => i.confidence !== "unsupported"));

  const groups: BusinessInvariantGroup[] = input.domain.workflows.map((workflow) => ({
    id: randomUUID(),
    workflowId: workflow.id,
    workflowKind: workflow.kind,
    label: workflow.label,
    invariantIds: filtered.filter((i) => i.workflowId === workflow.id).map((i) => i.id),
  }));

  const collection: BusinessInvariantCollection = {
    id: randomUUID(),
    groups,
    invariants: filtered,
    validationViolations: [],
    extractedAt: new Date().toISOString(),
  };

  return validateInvariantCollection(collection);
}

function invariantFromConstraint(
  workflow: BusinessWorkflow,
  machine: BusinessStateMachine,
  constraint: BusinessConstraint,
  entityIds: string[],
  actorIds: string[],
  discoveryMax: number
): BusinessInvariant {
  const evidence: BusinessInvariantEvidence[] = [
    ev("business_constraint", constraint.description, 0.9, constraint.id),
    ...constraint.metadata.evidence.map((e) =>
      ev("discovery_evidence", e.detail, e.confidence, e.id)
    ),
  ];

  const category = constraint.label.toLowerCase().includes("idempotent")
    ? "idempotency"
    : constraint.label.toLowerCase().includes("fulfillment")
      ? "payment_lifecycle"
      : "ordering";

  return buildInvariant({
      invariantKey: `${workflow.kind}:constraint:${slug(constraint.label)}`,
    title: constraint.label,
    description: constraint.description,
    whyItExists: "Declared workflow constraint from normalized business workflow model.",
    category,
    confidence: classifyConfidence({
      hasExplicitConstraint: true,
      hasGuardOnTransition: false,
      discoveryEvidenceMax: discoveryMax,
      fromAssumptionOnly: false,
    }),
    workflow,
    machine,
    entityIds,
    actorIds,
    supportingTransitionIds: [],
    relatedConstraintIds: [constraint.id],
    protectedValueKind: "monetary",
    protectedValueDescription: workflow.businessObjective,
    potentialImpact: "Constraint breach can cause direct business rule violation.",
    assumptions: [],
    evidence,
  });
}

function orderingInvariants(
  workflow: BusinessWorkflow,
  machine: BusinessStateMachine,
  entityIds: string[],
  actorIds: string[],
  discoveryMax: number
): BusinessInvariant[] {
  const happyTag = machine.metadata.tags.find((t) => t.startsWith("happy_path:"));
  if (!happyTag) return [];

  const segments = happyTag.replace("happy_path:", "").split(">");
  const transitionIds: string[] = [];
  for (let i = 0; i < segments.length - 1; i += 1) {
    const from = segments[i]!;
    const to = segments[i + 1]!;
    const t = machine.transitions.find((tr) => tr.fromStateId === from && tr.toStateId === to);
    if (t) transitionIds.push(t.id);
  }

  if (transitionIds.length === 0) return [];

  const evidence: BusinessInvariantEvidence[] = [
    ev("workflow_ordering", `Happy path ordering: ${segments.join(" → ")}`, 0.82, machine.id),
    ...machine.transitions
      .filter((t) => transitionIds.includes(t.id))
      .map((t) => ev("fsm_transition", `Transition ${t.event} guarded by ${t.guard ?? "none"}`, 0.8, t.id)),
  ];

  return [
    buildInvariant({
      invariantKey: `${workflow.kind}:ordering:happy_path`,
      title: "Workflow step ordering",
      description: `States must progress in order: ${segments.join(" → ")} unless an explicit alternate transition applies.`,
      whyItExists: "Business outcomes depend on completing prerequisite states before granting value.",
      category: "ordering",
      confidence: classifyConfidence({
        hasExplicitConstraint: false,
        hasGuardOnTransition: machine.transitions.some((t) => transitionIds.includes(t.id) && t.guard),
        discoveryEvidenceMax: discoveryMax,
        fromAssumptionOnly: false,
      }),
      workflow,
      machine,
      entityIds,
      actorIds,
      supportingTransitionIds: transitionIds,
      relatedConstraintIds: [],
      protectedValueKind: "monetary",
      protectedValueDescription: "Prevents value delivery before prerequisites are satisfied.",
      potentialImpact: "Out-of-order completion can grant access or goods without proper settlement.",
      assumptions: ["FSM happy path reflects intended business sequence."],
      evidence,
    }),
  ];
}

function idempotencyInvariants(
  workflow: BusinessWorkflow,
  machine: BusinessStateMachine,
  entityIds: string[],
  actorIds: string[],
  discoveryMax: number
): BusinessInvariant[] {
  const idempotentTransitions = machine.transitions.filter(
    (t) => t.retryPolicy === "idempotent_retry" || (t.guard ?? "").includes("idempotent")
  );
  if (idempotentTransitions.length === 0) return [];

  return idempotentTransitions.map((t) =>
    buildInvariant({
      invariantKey: `${workflow.kind}:idempotency:${t.fromStateId}:${t.toStateId}:${t.event}`,
      title: `Idempotent handling — ${t.event}`,
      description: `Repeating event "${t.event}" must not duplicate economic or entitlement effects.`,
      whyItExists: "Retries and duplicate client requests are expected in distributed billing and webhook flows.",
      category: "idempotency",
      confidence: classifyConfidence({
        hasExplicitConstraint: false,
        hasGuardOnTransition: Boolean(t.guard),
        discoveryEvidenceMax: discoveryMax,
        fromAssumptionOnly: false,
      }),
      workflow,
      machine,
      entityIds,
      actorIds,
      supportingTransitionIds: [t.id],
      relatedConstraintIds: [],
      protectedValueKind: t.economicEffect === "grant_access" ? "access" : "monetary",
      protectedValueDescription: "Duplicate application of the same event must be neutralized.",
      potentialImpact: "Double application can cause double spend, double entitlement, or duplicate rewards.",
      assumptions: ["Event identifiers or idempotency keys are persisted server-side."],
      evidence: [
        ev("fsm_transition", `Transition ${t.fromStateId} → ${t.toStateId} retry=${t.retryPolicy}`, 0.85, t.id),
        ev("transaction_ordering", `Guard: ${t.guard ?? "idempotent policy"}`, 0.8, t.id),
      ],
    })
  );
}

function rollbackInvariants(
  workflow: BusinessWorkflow,
  machine: BusinessStateMachine,
  entityIds: string[],
  actorIds: string[],
  discoveryMax: number
): BusinessInvariant[] {
  const rollbackTransitions = machine.transitions.filter((t) => t.rollbackTargetStateId);
  return rollbackTransitions.map((t) =>
    buildInvariant({
      invariantKey: `${workflow.kind}:rollback:${t.fromStateId}:${t.toStateId}:${t.event}`,
      title: `Rollback integrity — ${t.event}`,
      description: `Rollback from ${t.fromStateId} must restore consistent state at ${t.rollbackTargetStateId}.`,
      whyItExists: "Partial forward progress without compensating rollback leaves inconsistent balances or entitlements.",
      category: "retry_safety",
      confidence: classifyConfidence({
        hasExplicitConstraint: false,
        hasGuardOnTransition: Boolean(t.guard),
        discoveryEvidenceMax: discoveryMax,
        fromAssumptionOnly: false,
      }),
      workflow,
      machine,
      entityIds,
      actorIds,
      supportingTransitionIds: [t.id],
      relatedConstraintIds: [],
      protectedValueKind: "operational",
      protectedValueDescription: "Consistent rollback protects financial and access state.",
      potentialImpact: "Invalid rollback can orphan payments or leave entitlements active after cancel.",
      assumptions: ["Compensating actions are atomic with rollback transition."],
      evidence: [
        ev("rollback_behaviour", `Rollback target ${t.rollbackTargetStateId}`, 0.84, t.id),
        ev("fsm_transition", `Transition event ${t.event}`, 0.8, t.id),
      ],
    })
  );
}

function ownershipInvariants(
  workflow: BusinessWorkflow,
  machine: BusinessStateMachine,
  entities: BusinessEntity[],
  actorIds: string[],
  discoveryMax: number
): BusinessInvariant[] {
  const linkedEntities = entities.filter((e) =>
    workflow.resources.some((r) => r.linkedEntityId === e.id)
  );
  const results: BusinessInvariant[] = [];

  for (const entity of linkedEntities) {
    if (entity.ownership.scope === "unknown" && entity.ownership.ownerEntityId == null) continue;

    results.push(
      buildInvariant({
        invariantKey: `${workflow.kind}:ownership:${entity.kind}`,
        title: `Ownership — ${entity.label}`,
        description: `${entity.label} must remain owned by ${entity.ownership.ownerLabel} throughout workflow participation.`,
        whyItExists: "Business resources must not be manipulable across tenant or user boundaries.",
        category: "ownership",
        confidence: classifyConfidence({
          hasExplicitConstraint: false,
          hasGuardOnTransition: false,
          discoveryEvidenceMax: Math.max(discoveryMax, entity.confidence),
          fromAssumptionOnly: entity.ownership.scope === "unknown",
        }),
        workflow,
        machine,
        entityIds: [entity.id],
        actorIds,
        supportingTransitionIds: [],
        relatedConstraintIds: [],
        protectedValueKind: entity.value.kind,
        protectedValueDescription: entity.value.description,
        potentialImpact: "Ownership drift enables cross-account abuse without breaking endpoint authorization.",
        assumptions:
          entity.ownership.scope === "unknown"
            ? ["Owner identity inferred from discovery; verify in application code."]
            : [],
        evidence: [
          ev("ownership_model", `Owner scope: ${entity.ownership.scope}`, entity.confidence, entity.id),
          ...entity.metadata.evidence.map((e) => ev("discovery_evidence", e.detail, e.confidence, e.id)),
        ],
      })
    );
  }

  const statesWithoutOwner = machine.states.filter(
    (s) => s.kind !== "error" && s.ownerActorId == null
  );
  if (statesWithoutOwner.length > 0) {
    results.push(
      buildInvariant({
        invariantKey: `${workflow.kind}:ownership:state_actor`,
        title: "State actor ownership",
        description: "Non-error states should declare an owning actor responsible for transitions.",
        whyItExists: "Undefined ownership obscures who may legally trigger economic transitions.",
        category: "ownership",
        confidence: "inferred",
        workflow,
        machine,
        entityIds: linkedEntities.map((e) => e.id),
        actorIds,
        supportingTransitionIds: [],
        relatedConstraintIds: [],
        protectedValueKind: "operational",
        protectedValueDescription: "Clear actor ownership supports audit and abuse detection.",
        potentialImpact: "Ambiguous ownership complicates enforcement of business rules.",
        assumptions: ["Actor model from workflow discovery reflects runtime authorization."],
        evidence: [
          ev(
            "ownership_model",
            `States missing owner: ${statesWithoutOwner.map((s) => s.id).join(", ")}`,
            0.7,
            machine.id
          ),
        ],
      })
    );
  }

  return results;
}

function lifecycleInvariants(
  workflow: BusinessWorkflow,
  machine: BusinessStateMachine,
  entityIds: string[],
  actorIds: string[],
  discoveryMax: number
): BusinessInvariant[] {
  if (machine.terminalStateIds.length === 0) return [];

  return [
    buildInvariant({
      invariantKey: `${workflow.kind}:lifecycle:terminal`,
      title: "Terminal lifecycle completion",
      description: `Workflow must reach one of terminal states: ${machine.terminalStateIds.join(", ")}.`,
      whyItExists: "Terminal states represent durable business outcomes (paid, canceled, redeemed, etc.).",
      category: lifecycleCategoryForWorkflow(workflow.kind),
      confidence: classifyConfidence({
        hasExplicitConstraint: false,
        hasGuardOnTransition: false,
        discoveryEvidenceMax: discoveryMax,
        fromAssumptionOnly: false,
      }),
      workflow,
      machine,
      entityIds,
      actorIds,
      supportingTransitionIds: machine.transitions
        .filter((t) => machine.terminalStateIds.includes(t.toStateId))
        .map((t) => t.id),
      relatedConstraintIds: [],
      protectedValueKind: "access",
      protectedValueDescription: "Lifecycle integrity protects long-lived subscription and access state.",
      potentialImpact: "Stuck or ambiguous lifecycle states create support burden and abuse windows.",
      assumptions: [],
      evidence: [
        ev("terminal_state", `Terminal states: ${machine.terminalStateIds.join(", ")}`, 0.86, machine.id),
        ev("entity_lifecycle", workflow.businessObjective, discoveryMax, workflow.id),
      ],
    }),
  ];
}

function categorySpecificInvariants(
  workflow: BusinessWorkflow,
  machine: BusinessStateMachine,
  entityIds: string[],
  actorIds: string[],
  discoveryMax: number
): BusinessInvariant[] {
  switch (workflow.kind) {
    case "payment_webhook_settlement":
      return [
        buildInvariant({
          invariantKey: `${workflow.kind}:webhook_ordering`,
          title: "Webhook verify-before-apply",
          description: "Webhook payloads must be verified before settlement is applied to entitlements.",
          whyItExists: "Provider trust boundary requires signature verification before economic effects.",
          category: "webhook_ordering",
          confidence: "confirmed",
          workflow,
          machine,
          entityIds,
          actorIds,
          supportingTransitionIds: transitionsByEvent(machine, "verify_signature", "apply_settlement"),
          relatedConstraintIds: workflow.constraints.map((c) => c.id),
          protectedValueKind: "monetary",
          protectedValueDescription: "Settlement truth enters through verified webhooks only.",
          potentialImpact: "Forged or replayed webhooks can grant access without payment.",
          assumptions: ["Verification uses provider signing secret or equivalent."],
          evidence: [
            ev("fsm_transition", "received → verified → applied", 0.88, machine.id),
            ev("discovery_evidence", workflow.businessObjective, discoveryMax, workflow.id),
          ],
        }),
      ];
    case "credit_quota":
      return [
        buildInvariant({
          invariantKey: `${workflow.kind}:concurrency`,
          title: "Atomic credit debit",
          description: "Concurrent consume operations must not drive balance below zero.",
          whyItExists: "Credit and quota workflows are race-sensitive under parallel requests.",
          category: "concurrency",
          confidence: "strongly_inferred",
          workflow,
          machine,
          entityIds,
          actorIds,
          supportingTransitionIds: transitionsByEvent(machine, "begin_consume", "commit_consume"),
          relatedConstraintIds: [],
          protectedValueKind: "capacity",
          protectedValueDescription: "Quota and credit envelopes must stay non-negative.",
          potentialImpact: "Race wins can extract unbilled capacity.",
          assumptions: ["Debit uses transactional storage or equivalent serialization."],
          evidence: [
            ev("fsm_transition", "consuming state with race_detected transition", 0.82, machine.id),
          ],
        }),
      ];
    case "coupon_redemption":
      return [
        buildInvariant({
          invariantKey: `${workflow.kind}:coupon_lifecycle`,
          title: "Single coupon redemption",
          description: "A coupon must transition from issued to redeemed at most once per intended recipient policy.",
          whyItExists: "Promotional value is finite and must not be duplicated.",
          category: "coupon_lifecycle",
          confidence: "strongly_inferred",
          workflow,
          machine,
          entityIds,
          actorIds,
          supportingTransitionIds: transitionsByEvent(machine, "apply_coupon"),
          relatedConstraintIds: [],
          protectedValueKind: "monetary",
          protectedValueDescription: "Discount value must not be multiplied via replay.",
          potentialImpact: "Reuse drains margin and enables fraud.",
          assumptions: [],
          evidence: [ev("entity_lifecycle", "issued → redeemed terminal path", 0.8, machine.id)],
        }),
      ];
    case "invitation_referral":
      return [
        buildInvariant({
          invariantKey: `${workflow.kind}:invitation_lifecycle`,
          title: "One reward per valid invitation pair",
          description: "Referral rewards apply once per inviter-invitee pair.",
          whyItExists: "Referral programs otherwise suffer self-referral and replay abuse.",
          category: "invitation_lifecycle",
          confidence: "strongly_inferred",
          workflow,
          machine,
          entityIds,
          actorIds,
          supportingTransitionIds: transitionsByEvent(machine, "grant_reward"),
          relatedConstraintIds: [],
          protectedValueKind: "reputation",
          protectedValueDescription: "Growth incentives must map to genuine new accounts.",
          potentialImpact: "Duplicate rewards increase cost without customer acquisition.",
          assumptions: [],
          evidence: [ev("entity_lifecycle", "created → accepted → rewarded", 0.78, machine.id)],
        }),
      ];
    default:
      return [];
  }
}

function crossWorkflowInvariants(
  workflows: BusinessWorkflow[],
  machines: BusinessStateMachine[]
): BusinessInvariant[] {
  const hasCheckout = workflows.some((w) => w.kind === "payment_checkout");
  const hasWebhook = workflows.some((w) => w.kind === "payment_webhook_settlement");
  if (!hasCheckout || !hasWebhook) return [];

  const checkout = workflows.find((w) => w.kind === "payment_checkout")!;
  const webhook = workflows.find((w) => w.kind === "payment_webhook_settlement")!;
  const checkoutMachine = machines.find((m) => m.id === checkout.stateMachineId)!;
  const webhookMachine = machines.find((m) => m.id === webhook.stateMachineId)!;

  return [
    buildInvariant({
      invariantKey: "cross:payment_settlement_consistency",
      title: "Checkout fulfillment aligns with webhook settlement",
      description:
        "Entitlements granted at checkout must not bypass durable settlement confirmed via webhook (or equivalent provider confirmation).",
      whyItExists: "Split payment flows create classic fulfill-before-pay abuse when channels disagree.",
      category: "cross_workflow_consistency",
      confidence: "strongly_inferred",
      workflow: checkout,
      machine: checkoutMachine,
      entityIds: [],
      actorIds: checkout.actors.map((a) => a.id),
      supportingTransitionIds: [
        ...transitionsByEvent(checkoutMachine, "grant_entitlement"),
        ...transitionsByEvent(webhookMachine, "apply_settlement"),
      ],
      relatedConstraintIds: [...checkout.constraints, ...webhook.constraints].map((c) => c.id),
      protectedValueKind: "monetary",
      protectedValueDescription: "Revenue and entitlement must reflect the same settlement truth.",
      potentialImpact: "Fulfillment before settlement causes revenue loss.",
      assumptions: ["Both workflows operate on the same product billing domain."],
      evidence: [
        ev("workflow_ordering", `Checkout workflow ${checkout.id} linked to webhook ${webhook.id}`, 0.8, checkout.id),
        ev("discovery_evidence", checkout.businessObjective, checkout.confidence, checkout.id),
        ev("discovery_evidence", webhook.businessObjective, webhook.confidence, webhook.id),
      ],
    }),
  ];
}

function authenticationAssumptionInvariant(
  workflows: BusinessWorkflow[],
  signals: BusinessDiscoverySignals,
  machines: BusinessStateMachine[]
): BusinessInvariant {
  const workflow = workflows[0]!;
  const machine = machines.find((m) => m.id === workflow.stateMachineId) ?? machines[0]!;

  return buildInvariant({
    invariantKey: "assumption:authentication_binding",
    title: "Authenticated account binding",
    description: "Business resources that depend on user scope must bind to authenticated identities.",
    whyItExists: "Discovery detected authentication; entitlements and quotas are typically per-account.",
    category: "entitlement_consistency",
    confidence: "assumed",
    workflow,
    machine,
    entityIds: [],
    actorIds: workflow.actors.map((a) => a.id),
    supportingTransitionIds: [],
    relatedConstraintIds: [],
    protectedValueKind: "access",
    protectedValueDescription: "Prevents anonymous reuse of per-user economic limits.",
    potentialImpact: "Weak binding enables trial replay and quota evasion.",
    assumptions: [
      "Authentication team validates session integrity separately; RT9 consumes this as context only.",
    ],
    evidence: [
      ev(
        "authentication_assumption",
        `Authentication detected (${signals.hasAuthentication}) — not re-tested by RT9`,
        0.6,
        null
      ),
    ],
  });
}

function authorizationAssumptionInvariant(
  workflows: BusinessWorkflow[],
  signals: BusinessDiscoverySignals,
  machines: BusinessStateMachine[]
): BusinessInvariant {
  const adminWorkflow = workflows.find((w) => w.kind === "admin_business_operations") ?? workflows[0]!;
  const machine = machines.find((m) => m.id === adminWorkflow.stateMachineId) ?? machines[0]!;

  return buildInvariant({
    invariantKey: "assumption:admin_authorization",
    title: "Administrative action authorization",
    description: "High-impact business operations require staff authorization distinct from customer permissions.",
    whyItExists: "Admin surface detected; business operations must not rely on customer auth alone.",
    category: "ownership",
    confidence: "assumed",
    workflow: adminWorkflow,
    machine,
    entityIds: [],
    actorIds: adminWorkflow.actors.map((a) => a.id),
    supportingTransitionIds: [],
    relatedConstraintIds: [],
    protectedValueKind: "operational",
    protectedValueDescription: "Protects refunds, credits, and plan overrides.",
    potentialImpact: "Missing staff checks allow privilege escalation into business operations.",
    assumptions: [
      "Authorization team evaluates RBAC separately; RT9 references discovery context only.",
    ],
    evidence: [
      ev(
        "authorization_assumption",
        `Admin area signal (${signals.hasAdminArea}) — authorization not re-executed`,
        0.6,
        null
      ),
    ],
  });
}

function buildInvariant(input: {
  invariantKey: string;
  title: string;
  description: string;
  whyItExists: string;
  category: BusinessInvariantCategory;
  confidence: import("./invariant.types").BusinessInvariantConfidenceLevel;
  workflow: BusinessWorkflow;
  machine: BusinessStateMachine;
  entityIds: string[];
  actorIds: string[];
  supportingTransitionIds: string[];
  relatedConstraintIds: string[];
  protectedValueKind: import("../model/domain.types").BusinessValueKind;
  protectedValueDescription: string;
  potentialImpact: string;
  assumptions: string[];
  evidence: BusinessInvariantEvidence[];
}): BusinessInvariant {
  return {
    id: randomUUID(),
    invariantKey: input.invariantKey,
    title: input.title,
    description: input.description,
    whyItExists: input.whyItExists,
    protectedValueKind: input.protectedValueKind,
    protectedValueDescription: input.protectedValueDescription,
    category: input.category,
    confidence: input.confidence,
    workflowId: input.workflow.id,
    stateMachineId: input.machine.id,
    entityIds: input.entityIds,
    actorIds: input.actorIds,
    supportingTransitionIds: input.supportingTransitionIds,
    relatedConstraintIds: input.relatedConstraintIds,
    potentialImpact: input.potentialImpact,
    assumptions: input.assumptions,
    evidence: mergeInvariantEvidence(input.evidence),
  };
}

function ev(
  source: BusinessInvariantSource,
  detail: string,
  confidence: number,
  refId: string | null
): BusinessInvariantEvidence {
  return { id: randomUUID(), source, detail, confidence, refId };
}

function maxEvidenceConfidence(evidence: { confidence: number }[]): number {
  if (evidence.length === 0) return 0;
  return Math.max(...evidence.map((e) => e.confidence));
}

function transitionsByEvent(machine: BusinessStateMachine, ...events: string[]): string[] {
  return machine.transitions.filter((t) => events.includes(t.event)).map((t) => t.id);
}

function lifecycleCategoryForWorkflow(kind: string): BusinessInvariantCategory {
  if (kind.includes("subscription")) return "subscription_lifecycle";
  if (kind.includes("payment") || kind.includes("checkout")) return "payment_lifecycle";
  if (kind.includes("invitation")) return "invitation_lifecycle";
  if (kind.includes("coupon")) return "coupon_lifecycle";
  if (kind.includes("credit")) return "credit_integrity";
  return "temporal_constraints";
}

function dedupeInvariants(invariants: BusinessInvariant[]): BusinessInvariant[] {
  const byKey = new Map<string, BusinessInvariant>();
  for (const invariant of invariants) {
    const existing = byKey.get(invariant.invariantKey);
    if (!existing) {
      byKey.set(invariant.invariantKey, invariant);
      continue;
    }
    if (confidenceRank(invariant.confidence) < confidenceRank(existing.confidence)) {
      byKey.set(invariant.invariantKey, invariant);
    }
  }
  return [...byKey.values()];
}

function confidenceRank(level: import("./invariant.types").BusinessInvariantConfidenceLevel): number {
  const order = ["explicit", "confirmed", "strongly_inferred", "inferred", "assumed", "unsupported"];
  return order.indexOf(level);
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export const BusinessInvariantExtractor = { extract: extractBusinessInvariants };
