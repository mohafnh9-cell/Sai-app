import { randomUUID } from "node:crypto";
import type {
  DiscoveredBusinessActor,
  DiscoveredBusinessResource,
  DiscoveredBusinessWorkflow,
  DiscoveredBusinessWorkflowKind,
} from "../discovery/discovery.types";
import type {
  BusinessActor,
  BusinessActorRole,
  BusinessConstraint,
  BusinessResource,
  BusinessResourceKind,
  BusinessRiskArea,
  BusinessWorkflow,
  BusinessWorkflowStep,
} from "./domain.types";
import { buildMetadata } from "./evidence";
import { entityIdByKind, type BusinessEntity } from "./normalize-entity";

const RESOURCE_MAP: Record<DiscoveredBusinessResource["kind"], BusinessResourceKind> = {
  payment: "payment",
  subscription: "subscription",
  order: "order",
  credit_balance: "credit_balance",
  quota: "quota",
  coupon: "coupon",
  invitation: "invitation",
  admin_config: "admin_config",
  webhook_event: "webhook_event",
  user_account: "user_account",
};

const WORKFLOW_RISKS: Record<DiscoveredBusinessWorkflowKind, BusinessRiskArea[]> = {
  payment_checkout: ["economic", "ordering", "idempotency"],
  payment_webhook_settlement: ["idempotency", "ordering", "economic"],
  subscription_lifecycle: ["economic", "ordering", "access_control"],
  credit_quota: ["concurrency", "economic", "capacity"],
  coupon_redemption: ["economic", "idempotency"],
  invitation_referral: ["economic", "access_control"],
  admin_business_operations: ["access_control", "audit", "economic"],
};

export function normalizeDiscoveredWorkflow(
  discovered: DiscoveredBusinessWorkflow,
  entities: BusinessEntity[],
  stateMachineId: string
): BusinessWorkflow {
  const actors = discovered.actors
    .map((a) => normalizeActor(a, discovered))
    .sort((a, b) => actorSortRank(a.role) - actorSortRank(b.role));
  const resources = discovered.resources.map((r) => normalizeResource(r, discovered, entities));

  return {
    id: randomUUID(),
    kind: discovered.kind,
    label: discovered.label,
    businessObjective: discovered.businessObjective,
    confidence: discovered.confidence,
    actors,
    resources,
    steps: [],
    constraints: defaultConstraints(discovered.kind, discovered),
    riskAreas: WORKFLOW_RISKS[discovered.kind] ?? ["ordering"],
    stateMachineId,
    metadata: buildMetadata({
      discoveredWorkflowId: discovered.id,
      discoveredWorkflowKind: discovered.kind,
      evidence: discovered.evidence,
      tags: [discovered.kind],
    }),
  };
}

function actorSortRank(role: BusinessActorRole): number {
  const order: BusinessActorRole[] = ["customer", "admin", "webhook_processor", "system", "service", "anonymous"];
  const index = order.indexOf(role);
  return index === -1 ? 99 : index;
}

function normalizeActor(
  discovered: DiscoveredBusinessActor,
  workflow: DiscoveredBusinessWorkflow
): BusinessActor {
  const role = discovered.role as BusinessActorRole;
  return {
    id: randomUUID(),
    role,
    label: discovered.label,
    metadata: buildMetadata({
      discoveredWorkflowId: workflow.id,
      discoveredWorkflowKind: workflow.kind,
      evidence: discovered.evidence,
      tags: ["actor", role],
    }),
  };
}

function normalizeResource(
  discovered: DiscoveredBusinessResource,
  workflow: DiscoveredBusinessWorkflow,
  entities: BusinessEntity[]
): BusinessResource {
  const kind = RESOURCE_MAP[discovered.kind];
  const entityKindMap: Partial<Record<DiscoveredBusinessResource["kind"], Parameters<typeof entityIdByKind>[1]>> = {
    payment: "payment",
    subscription: "subscription",
    order: "order",
    credit_balance: "credit",
    quota: "quota",
    coupon: "coupon",
    invitation: "invitation",
    admin_config: "admin_config",
    webhook_event: "webhook",
    user_account: "user",
  };
  const linkedEntityId = entityIdByKind(entities, entityKindMap[discovered.kind] ?? "payment");

  return {
    id: randomUUID(),
    kind,
    label: discovered.label,
    linkedEntityId,
    metadata: buildMetadata({
      discoveredWorkflowId: workflow.id,
      discoveredWorkflowKind: workflow.kind,
      evidence: discovered.evidence,
      tags: ["resource", kind],
    }),
  };
}

function defaultConstraints(
  kind: DiscoveredBusinessWorkflowKind,
  workflow: DiscoveredBusinessWorkflow
): BusinessConstraint[] {
  const base = buildMetadata({
    discoveredWorkflowId: workflow.id,
    discoveredWorkflowKind: kind,
    evidence: workflow.evidence,
    tags: ["constraint"],
  });
  switch (kind) {
    case "payment_checkout":
      return [
        {
          id: randomUUID(),
          label: "Settlement before fulfillment",
          description: "Value must not be granted before payment is confirmed.",
          severity: "warning",
          metadata: base,
        },
      ];
    case "payment_webhook_settlement":
      return [
        {
          id: randomUUID(),
          label: "Idempotent webhook handling",
          description: "Duplicate provider events must not double-apply entitlements.",
          severity: "warning",
          metadata: base,
        },
      ];
    default:
      return [];
  }
}

export function attachStepsFromStateMachine(
  workflow: BusinessWorkflow,
  stateIdsInOrder: string[],
  stateLabels: Map<string, string>,
  evidence: DiscoveredBusinessWorkflow["evidence"]
): BusinessWorkflow {
  const steps: BusinessWorkflowStep[] = stateIdsInOrder.map((stateId, index) => ({
    id: randomUUID(),
    order: index + 1,
    label: stateLabels.get(stateId) ?? stateId,
    stateId,
    metadata: buildMetadata({
      discoveredWorkflowId: workflow.metadata.discoveredWorkflowId,
      discoveredWorkflowKind: workflow.kind,
      evidence,
      tags: ["step", stateId],
    }),
  }));
  return { ...workflow, steps };
}
