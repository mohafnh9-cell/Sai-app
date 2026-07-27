import type { AttackPlan } from "../../types";
import type { DiscoveryReport } from "../../discovery/types";
import type { ApiSurfaceInventory } from "../../teams/api/discovery/api-surface-builder";

/** Evidence backing an inferred business artifact — never synthetic vulnerability claims. */
export type BusinessDiscoveryEvidence = {
  id: string;
  source:
    | "discovery_report"
    | "attack_surface"
    | "payment_provider"
    | "api_inventory"
    | "database"
    | "authentication"
    | "project_summary";
  detail: string;
  confidence: number;
};

export type DiscoveredBusinessActor = {
  id: string;
  role: "customer" | "admin" | "system" | "webhook_processor" | "anonymous";
  label: string;
  evidence: BusinessDiscoveryEvidence[];
};

export type DiscoveredBusinessResource = {
  id: string;
  kind:
    | "payment"
    | "subscription"
    | "order"
    | "credit_balance"
    | "quota"
    | "coupon"
    | "invitation"
    | "admin_config"
    | "webhook_event"
    | "user_account";
  label: string;
  evidence: BusinessDiscoveryEvidence[];
};

export type DiscoveredBusinessEntity = {
  id: string;
  kind: DiscoveredBusinessResource["kind"];
  label: string;
  confidence: number;
  evidence: BusinessDiscoveryEvidence[];
};

export type DiscoveredBusinessWorkflowKind =
  | "payment_checkout"
  | "payment_webhook_settlement"
  | "subscription_lifecycle"
  | "credit_quota"
  | "coupon_redemption"
  | "invitation_referral"
  | "admin_business_operations";

export type DiscoveredBusinessWorkflow = {
  id: string;
  kind: DiscoveredBusinessWorkflowKind;
  label: string;
  businessObjective: string;
  confidence: number;
  evidence: BusinessDiscoveryEvidence[];
  actors: DiscoveredBusinessActor[];
  resources: DiscoveredBusinessResource[];
};

export type BusinessDiscoverySignals = {
  paymentProviders: string[];
  hasPaymentsSurface: boolean;
  hasWebhooksSurface: boolean;
  hasRestApi: boolean;
  hasAuthentication: boolean;
  hasAdminArea: boolean;
  hasDatabase: boolean;
  databaseTechnologies: string[];
  webhookEndpoints: string[];
  billingRouteHints: string[];
  summaryHints: {
    credits: boolean;
    quotas: boolean;
    coupons: boolean;
    invitations: boolean;
    subscriptions: boolean;
  };
  apiSurface: ApiSurfaceInventory;
};

export type WorkflowDiscoveryResult = {
  signals: BusinessDiscoverySignals;
  entities: DiscoveredBusinessEntity[];
  workflows: DiscoveredBusinessWorkflow[];
};

export type BusinessLogicTeamContext = {
  businessLogicTeamRunId: string;
  redTeamRunId: string;
  organizationId: string;
  projectId: string;
  commitSha: string | null;
  discovery: DiscoveryReport;
  plan: AttackPlan;
  signals: BusinessDiscoverySignals;
  entities: DiscoveredBusinessEntity[];
  workflows: DiscoveredBusinessWorkflow[];
  /** Canonical domain model + FSMs (Slice 2+). */
  domainModel?: import("../model/domain.types").BusinessDomainModel;
};
