import type { DiscoveryReport } from "../../discovery/types";
import type { AttackPlan } from "../../types";
import type { AuthorizationMatrix } from "./model/authorization-matrix";
import type { AuthorizationRoleGraph } from "./model/role-graph";
import type { AuthorizationResourceGraph } from "./model/resource-graph";
import type { AuthzFindingRecord } from "./findings/authorization-finding";
import type { AuthzReplayPlan } from "./replay/authorization-replay-plan";
import type { AuthzPolicySignals } from "./discovery/authz-discovery";

export type AuthzAction =
  | "read"
  | "write"
  | "create"
  | "delete"
  | "update"
  | "invite"
  | "export"
  | "manage"
  | "configure"
  | "rotate"
  | "impersonate";

export type SyntheticIdentity = {
  id: string;
  label: string;
  role: string;
  tenantId: string;
};

export type AuthorizationTeamContext = {
  authorizationTeamRunId: string;
  redTeamRunId: string;
  organizationId: string;
  projectId: string;
  commitSha: string | null;
  discovery: DiscoveryReport;
  plan: AttackPlan;
  policies: AuthzPolicySignals;
  roleGraph: AuthorizationRoleGraph;
  resourceGraph: AuthorizationResourceGraph;
  matrix: AuthorizationMatrix;
  identities: SyntheticIdentity[];
};

export type AuthzScenario = {
  id: string;
  specialistId: string;
  title: string;
  role: string;
  resource: string;
  action: AuthzAction;
  kind: string;
};

export interface AuthorizationSpecialist {
  readonly id: string;
  readonly name: string;
  readonly priority: number;
  canRun(context: AuthorizationTeamContext): boolean | Promise<boolean>;
  plan(context: AuthorizationTeamContext): Promise<AuthzScenario[]>;
  execute(
    runtime: import("./runtime/safe-authz-runtime").SafeAuthzRuntime,
    scenario: AuthzScenario,
    context: AuthorizationTeamContext
  ): Promise<AuthzSpecialistResult>;
}

export type AuthzSpecialistResult = {
  specialistId: string;
  scenariosExecuted: number;
  findings: AuthzFindingRecord[];
  evaluations: number;
  logs: string[];
};

export type AuthorizationTeamResult = {
  authorizationTeamRunId: string;
  status: "completed" | "partially_completed" | "failed";
  rolesDetected: number;
  resourcesDetected: number;
  matrixSize: number;
  findings: AuthzFindingRecord[];
  replayPlans: AuthzReplayPlan[];
  safeFixCandidateCount: number;
  roleGraph: AuthorizationRoleGraph;
  resourceGraph: AuthorizationResourceGraph;
  matrix: AuthorizationMatrix;
  partialReason?: string | null;
};

export type AuthorizationTeamInput = {
  organizationId: string;
  projectId: string;
  runId: string;
  requestId: string;
  discoveryReport: DiscoveryReport;
  plan: AttackPlan;
  signal?: AbortSignal;
};
