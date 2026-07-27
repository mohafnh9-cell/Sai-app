/** Provider-agnostic canonical evidence (traceability to discovery). */
export type BusinessEvidenceRef = {
  id: string;
  source: string;
  detail: string;
  confidence: number;
};

export type BusinessMetadata = {
  discoveredEntityId?: string | null;
  discoveredWorkflowId?: string | null;
  discoveredWorkflowKind?: string | null;
  tags: string[];
  evidence: BusinessEvidenceRef[];
};

export type BusinessValueKind =
  | "monetary"
  | "access"
  | "capacity"
  | "reputation"
  | "operational"
  | "none";

export type BusinessValue = {
  kind: BusinessValueKind;
  description: string;
  magnitude: "low" | "medium" | "high";
};

export type BusinessLifecyclePhase =
  | "draft"
  | "pending"
  | "active"
  | "suspended"
  | "completed"
  | "revoked"
  | "expired"
  | "failed";

export type BusinessLifecycle = {
  phase: BusinessLifecyclePhase;
  label: string;
};

export type BusinessRelationshipKind =
  | "owns"
  | "belongs_to"
  | "grants"
  | "consumes"
  | "references"
  | "audited_by";

export type BusinessRelationship = {
  id: string;
  kind: BusinessRelationshipKind;
  fromEntityId: string;
  toEntityId: string;
  label: string;
};

export type BusinessEntityKind =
  | "subscription"
  | "invoice"
  | "payment"
  | "credit"
  | "coupon"
  | "invitation"
  | "membership"
  | "quota"
  | "reward"
  | "organization"
  | "workspace"
  | "user"
  | "role"
  | "entitlement"
  | "api_key"
  | "webhook"
  | "order"
  | "admin_config";

export type BusinessOwnership = {
  ownerEntityId: string | null;
  ownerLabel: string;
  scope: "user" | "organization" | "workspace" | "system" | "unknown";
};

export type BusinessEntity = {
  id: string;
  kind: BusinessEntityKind;
  label: string;
  confidence: number;
  ownership: BusinessOwnership;
  lifecycle: BusinessLifecycle;
  relationships: BusinessRelationship[];
  value: BusinessValue;
  metadata: BusinessMetadata;
};

export type BusinessActorRole =
  | "customer"
  | "admin"
  | "system"
  | "webhook_processor"
  | "anonymous"
  | "service";

export type BusinessActor = {
  id: string;
  role: BusinessActorRole;
  label: string;
  metadata: BusinessMetadata;
};

export type BusinessResourceKind =
  | "payment"
  | "subscription"
  | "order"
  | "credit_balance"
  | "quota"
  | "coupon"
  | "invitation"
  | "entitlement"
  | "webhook_event"
  | "admin_config"
  | "user_account";

export type BusinessResource = {
  id: string;
  kind: BusinessResourceKind;
  label: string;
  linkedEntityId: string | null;
  metadata: BusinessMetadata;
};

export type BusinessWorkflowStep = {
  id: string;
  order: number;
  label: string;
  stateId: string;
  metadata: BusinessMetadata;
};

export type BusinessConstraint = {
  id: string;
  label: string;
  description: string;
  severity: "info" | "warning";
  metadata: BusinessMetadata;
};

export type BusinessRiskArea =
  | "economic"
  | "access_control"
  | "concurrency"
  | "idempotency"
  | "ordering"
  | "audit";

export type BusinessWorkflow = {
  id: string;
  kind: string;
  label: string;
  businessObjective: string;
  confidence: number;
  actors: BusinessActor[];
  resources: BusinessResource[];
  steps: BusinessWorkflowStep[];
  constraints: BusinessConstraint[];
  riskAreas: BusinessRiskArea[];
  stateMachineId: string;
  metadata: BusinessMetadata;
};

export type BusinessStateKind = "initial" | "normal" | "terminal" | "error";

export type BusinessState = {
  id: string;
  name: string;
  kind: BusinessStateKind;
  description: string;
  ownerActorId: string | null;
  metadata: BusinessMetadata;
};

export type EconomicEffect = "charge" | "refund" | "grant_access" | "revoke_access" | "consume_credit" | "none";

export type SideEffectKind = "persist" | "notify" | "emit_event" | "external_call";

export type BusinessTransition = {
  id: string;
  fromStateId: string;
  toStateId: string;
  event: string;
  guard: string | null;
  actorId: string | null;
  entryActions: string[];
  exitActions: string[];
  rollbackTargetStateId: string | null;
  retryPolicy: "none" | "idempotent_retry" | "manual_retry";
  economicEffect: EconomicEffect;
  sideEffects: SideEffectKind[];
  metadata: BusinessMetadata;
};

export type BusinessStateNode = BusinessState;

export type BusinessStateEdge = BusinessTransition;

export type BusinessStateMachine = {
  id: string;
  workflowId: string;
  label: string;
  initialStateId: string;
  states: BusinessStateNode[];
  transitions: BusinessStateEdge[];
  terminalStateIds: string[];
  errorStateIds: string[];
  metadata: BusinessMetadata;
};

export type BusinessExecutionPath = {
  id: string;
  stateMachineId: string;
  stateIds: string[];
  label: string;
};

export type BusinessWorkflowGraph = {
  workflowIds: string[];
  entityIds: string[];
  relationships: BusinessRelationship[];
  executionPaths: BusinessExecutionPath[];
};

export type StateMachineValidationCode =
  | "missing_terminal_state"
  | "unreachable_state"
  | "duplicate_transition"
  | "missing_initial_reachability"
  | "invalid_rollback_target"
  | "missing_ownership"
  | "invalid_ordering_hint";

export type StateMachineValidationIssue = {
  code: StateMachineValidationCode;
  stateMachineId: string;
  message: string;
  stateId?: string | null;
  transitionId?: string | null;
};

export type BusinessDomainModel = {
  entities: BusinessEntity[];
  workflows: BusinessWorkflow[];
  stateMachines: BusinessStateMachine[];
  workflowGraph: BusinessWorkflowGraph;
  validationIssues: StateMachineValidationIssue[];
  invariantCollection?: import("../invariants/invariant.types").BusinessInvariantCollection;
  abuseCollection?: import("../abuse/abuse.types").BusinessAbuseCollection;
  specialistExecution?: import("../specialists/specialist.types").BusinessLogicSpecialistExecutionSummary;
  runtimeExecution?: import("../runtime/runtime.types").BusinessLogicExecutionSummary;
  findingCollection?: import("../findings/finding.types").BusinessLogicFindingCollection;
};
