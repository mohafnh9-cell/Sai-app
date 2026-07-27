import type { ProductionMemorySnapshot } from "../intelligence/models";
import type { AcceptedRiskRecord } from "./decision-model";

export type DeploymentEnvironment = "local" | "preview" | "staging" | "production";

export type SafeFixStatus = "none" | "pending" | "applied" | "verified";

export type ReplayStatus = "not_run" | "passed" | "failed" | "unavailable";

export type RedTeamRunStatus = "none" | "queued" | "running" | "completed" | "partial" | "failed";

export type DecisionContext = {
  projectId: string;
  organizationId: string;
  commitSha: string | null;
  deploymentEnvironment: DeploymentEnvironment;
  memory?: ProductionMemorySnapshot | null;
  acceptedRisks?: AcceptedRiskRecord[];
  safeFixStatus?: SafeFixStatus;
  replayStatus?: ReplayStatus;
  redTeamRunStatus?: RedTeamRunStatus;
  evidenceCommitSha?: string | null;
  previousDecision?: import("./decision-model").SecurityDecisionType | null;
  minCoverageScore?: number;
};

export const DEFAULT_MIN_COVERAGE_SCORE = 0.35;
