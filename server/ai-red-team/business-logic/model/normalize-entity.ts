import { randomUUID } from "node:crypto";
import type { DiscoveredBusinessEntity } from "../discovery/discovery.types";
import type {
  BusinessEntity,
  BusinessEntityKind,
  BusinessLifecycle,
  BusinessOwnership,
  BusinessRelationship,
  BusinessValue,
} from "./domain.types";
import { buildMetadata } from "./evidence";

const DISCOVERED_TO_CANONICAL: Record<
  DiscoveredBusinessEntity["kind"],
  BusinessEntityKind
> = {
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

export function normalizeDiscoveredEntities(
  discovered: DiscoveredBusinessEntity[]
): BusinessEntity[] {
  const hasUser = discovered.some((d) => d.kind === "user_account");
  const userId = hasUser ? randomUUID() : null;

  return discovered.map((d) => {
    const entity = normalizeDiscoveredEntity(d, { userEntityId: userId, organizationEntityId: null });
    if (d.kind === "user_account" && userId) {
      entity.id = userId;
    }
    entity.relationships = patchRelationshipFromIds(entity.relationships, entity.id, userId);
    return entity;
  });
}

export function normalizeDiscoveredEntity(
  discovered: DiscoveredBusinessEntity,
  options?: { organizationEntityId?: string | null; userEntityId?: string | null }
): BusinessEntity {
  const kind = DISCOVERED_TO_CANONICAL[discovered.kind];
  return {
    id: randomUUID(),
    kind,
    label: discovered.label,
    confidence: discovered.confidence,
    ownership: resolveOwnership(discovered.kind, options),
    lifecycle: defaultLifecycle(discovered.kind),
    relationships: buildRelationships(discovered.kind, options),
    value: defaultValue(discovered.kind),
    metadata: buildMetadata({
      discoveredEntityId: discovered.id,
      evidence: discovered.evidence,
      tags: [discovered.kind],
    }),
  };
}

function patchRelationshipFromIds(
  relationships: BusinessRelationship[],
  entityId: string,
  userId: string | null
): BusinessRelationship[] {
  if (!userId) return relationships;
  return relationships.map((r) =>
    r.fromEntityId === "pending" ? { ...r, fromEntityId: entityId } : r
  );
}

function resolveOwnership(
  kind: DiscoveredBusinessEntity["kind"],
  options?: { organizationEntityId?: string | null; userEntityId?: string | null }
): BusinessOwnership {
  switch (kind) {
    case "user_account":
      return { ownerEntityId: null, ownerLabel: "Self", scope: "user" };
    case "admin_config":
      return {
        ownerEntityId: options?.organizationEntityId ?? null,
        ownerLabel: "Organization administrators",
        scope: "organization",
      };
    case "webhook_event":
      return { ownerEntityId: null, ownerLabel: "System processor", scope: "system" };
    case "payment":
    case "subscription":
    case "order":
    case "credit_balance":
    case "quota":
    case "coupon":
    case "invitation":
      return {
        ownerEntityId: options?.userEntityId ?? null,
        ownerLabel: options?.userEntityId ? "Account owner" : "Customer (unknown id)",
        scope: options?.userEntityId ? "user" : "unknown",
      };
    default:
      return { ownerEntityId: null, ownerLabel: "Unknown", scope: "unknown" };
  }
}

function defaultLifecycle(kind: DiscoveredBusinessEntity["kind"]): BusinessLifecycle {
  const map: Record<DiscoveredBusinessEntity["kind"], BusinessLifecycle> = {
    payment: { phase: "pending", label: "Payment lifecycle" },
    subscription: { phase: "active", label: "Subscription lifecycle" },
    order: { phase: "pending", label: "Order lifecycle" },
    credit_balance: { phase: "active", label: "Credit balance" },
    quota: { phase: "active", label: "Quota envelope" },
    coupon: { phase: "draft", label: "Coupon validity" },
    invitation: { phase: "pending", label: "Invitation lifecycle" },
    admin_config: { phase: "active", label: "Administrative configuration" },
    webhook_event: { phase: "pending", label: "Webhook processing" },
    user_account: { phase: "active", label: "User account" },
  };
  return map[kind];
}

function defaultValue(kind: DiscoveredBusinessEntity["kind"]): BusinessValue {
  switch (kind) {
    case "payment":
    case "subscription":
    case "order":
    case "coupon":
      return { kind: "monetary", description: "Direct revenue or discount impact", magnitude: "high" };
    case "credit_balance":
    case "quota":
      return { kind: "capacity", description: "Metered consumption capacity", magnitude: "medium" };
    case "invitation":
      return { kind: "reputation", description: "Growth and referral value", magnitude: "medium" };
    case "admin_config":
      return { kind: "operational", description: "Operational control surface", magnitude: "high" };
    case "webhook_event":
      return { kind: "operational", description: "Settlement truth channel", magnitude: "high" };
    case "user_account":
      return { kind: "access", description: "Account access boundary", magnitude: "medium" };
    default:
      return { kind: "none", description: "Unclassified", magnitude: "low" };
  }
}

function buildRelationships(
  kind: DiscoveredBusinessEntity["kind"],
  options?: { organizationEntityId?: string | null; userEntityId?: string | null }
): BusinessRelationship[] {
  const rels: BusinessRelationship[] = [];
  if (options?.userEntityId && kind !== "user_account") {
    rels.push({
      id: randomUUID(),
      kind: "belongs_to",
      fromEntityId: "pending",
      toEntityId: options.userEntityId,
      label: "Owned by user account",
    });
  }
  return rels;
}

export function entityIdByKind(
  entities: BusinessEntity[],
  kind: BusinessEntityKind
): string | null {
  return entities.find((e) => e.kind === kind)?.id ?? null;
}
