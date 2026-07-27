import type { AttackAuthorizationRecord, AttackEnvironmentType } from "../../authorization";
import type { DiscoveryReport } from "../../discovery/types";
import type { AttackPlan } from "../../types";
import type { ApiFindingRecord } from "./findings/api-finding";
import type { ApiSurfaceInventory } from "./discovery/api-surface-builder";
import type { ApiReplayPlan } from "./replay/api-replay-plan";

export type ApiCapability =
  | "inventory"
  | "validation"
  | "access_control"
  | "cors"
  | "rate_limit"
  | "graphql"
  | "errors"
  | "upload"
  | "webhook";

export type ApiTeamLifecycleState =
  | "queued"
  | "running"
  | "completed"
  | "partially_completed"
  | "failed"
  | "timed_out"
  | "cancelled";

export type ApiScenario = {
  id: string;
  specialistId: string;
  title: string;
  route: string;
  method: string;
  kind: string;
};

export type ApiTeamContext = {
  apiTeamRunId: string;
  redTeamRunId: string;
  organizationId: string;
  projectId: string;
  commitSha: string | null;
  targetOrigin: string;
  environmentType: AttackEnvironmentType;
  authorization: AttackAuthorizationRecord;
  discovery: DiscoveryReport;
  plan: AttackPlan;
  surface: ApiSurfaceInventory;
};

export type ApiSpecialistResult = {
  specialistId: string;
  scenariosExecuted: number;
  findings: ApiFindingRecord[];
  logs: string[];
};

export interface ApiSpecialist {
  readonly id: string;
  readonly name: string;
  readonly priority: number;
  readonly capabilities: ApiCapability[];
  canRun(context: ApiTeamContext): boolean | Promise<boolean>;
  plan(context: ApiTeamContext): Promise<ApiScenario[]>;
  execute(
    runtime: import("./runtime/safe-api-runtime").SafeApiRuntime,
    scenario: ApiScenario,
    context: ApiTeamContext
  ): Promise<ApiSpecialistResult>;
}

export type ApiTeamResult = {
  apiTeamRunId: string;
  status: ApiTeamLifecycleState;
  endpointsDiscovered: number;
  scenariosExecuted: number;
  findings: ApiFindingRecord[];
  replayPlans: ApiReplayPlan[];
  safeFixCandidateCount: number;
  surface: ApiSurfaceInventory;
  partialReason?: string | null;
};

export type ApiTeamInput = {
  organizationId: string;
  projectId: string;
  runId: string;
  requestId: string;
  targetOrigin: string;
  environment: AttackEnvironmentType;
  commitSha?: string | null;
  authorization: AttackAuthorizationRecord;
  discoveryReport: DiscoveryReport;
  plan: AttackPlan;
  signal?: AbortSignal;
};
