import type { AttackEnvironmentType, AttackAuthorizationRecord } from "../../authorization";
import type { DiscoveryReport } from "../../discovery/types";
import type { AttackPlan } from "../../types";

export type BrowserCapability =
  | "navigation"
  | "forms"
  | "session"
  | "storage"
  | "console"
  | "headers"
  | "redirects"
  | "errors";

export type BrowserTeamLifecycleState =
  | "queued"
  | "running"
  | "completed"
  | "partially_completed"
  | "failed"
  | "timed_out"
  | "cancelled";

export type BrowserScenario = {
  id: string;
  specialistId: string;
  title: string;
  route: string;
  kind: string;
  metadata?: Record<string, unknown>;
};

export type BrowserTeamContext = {
  redTeamRunId: string;
  browserTeamRunId: string;
  organizationId: string;
  projectId: string;
  commitSha: string | null;
  targetUrl: string;
  targetOrigin: string;
  environmentType: AttackEnvironmentType;
  authorization: AttackAuthorizationRecord;
  discovery: DiscoveryReport;
  plan: AttackPlan;
  pathExclusions: string[];
  testCredentialsRef: string | null;
};

export type BrowserSpecialistResult = {
  specialistId: string;
  scenariosExecuted: number;
  findings: import("./browser-findings").BrowserFindingRecord[];
  evidence: import("./browser-findings").BrowserEvidenceRecord[];
  logs: string[];
  error?: string | null;
};

export type BrowserTeamResult = {
  browserTeamRunId: string;
  status: BrowserTeamLifecycleState;
  routesExplored: number;
  scenariosExecuted: number;
  findings: import("./browser-findings").BrowserFindingRecord[];
  routeGraph: import("./exploration/route-graph").RouteGraph;
  summary: BrowserTeamUserSummary;
  partialReason?: string | null;
};

export type BrowserTeamUserSummary = {
  status: string;
  areasExplored: string[];
  scenariosExecuted: number;
  confirmedFindings: number;
  highestConcern: string | null;
  founderVerdict: string;
  coverageNotes: string[];
  recommendedNextAction: string | null;
};

export interface BrowserSpecialist {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly priority: number;
  readonly capabilities: readonly BrowserCapability[];
  readonly supportedEnvironments: readonly AttackEnvironmentType[];
  canRun(context: BrowserTeamContext): boolean | Promise<boolean>;
  plan(context: BrowserTeamContext): Promise<BrowserScenario[]>;
  execute(
    runtime: import("./runtime/safe-browser-runtime").SafeBrowserRuntime,
    scenario: BrowserScenario,
    context: BrowserTeamContext
  ): Promise<BrowserSpecialistResult>;
}
