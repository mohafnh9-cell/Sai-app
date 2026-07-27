import type { DiscoveryReport } from "../discovery/types";
import type { AttackPlan } from "../types";

export type BusinessLogicTeamLifecycleState =
  | "completed"
  | "skipped"
  | "failed"
  | "partially_completed";

/** How much business analysis ran in this execution. */
export type BusinessLogicExecutionMode = "skeleton" | "analysis";

export type BusinessLogicAttackContext = {
  discovery: DiscoveryReport;
  plan: AttackPlan;
  redTeamRunId?: string;
};

export type BusinessLogicTeamInput = {
  organizationId: string;
  projectId: string;
  runId: string;
  requestId: string;
  discoveryReport: DiscoveryReport;
  plan: AttackPlan;
  signal?: AbortSignal;
};

export type BusinessLogicTeamResult = {
  businessLogicTeamRunId: string;
  status: BusinessLogicTeamLifecycleState;
  /** Why the team did not run — only when `status` is `skipped` or `failed`. */
  skippedReason?: string | null;
  /** RT9 pipeline stage identifier (e.g. Phase 1 skeleton). */
  analysisPhase: string;
  /** Distinguishes integration skeleton runs from full analysis (Phase 2+). */
  executionMode: BusinessLogicExecutionMode;
  /**
   * Why business analysis was deferred while execution still succeeded.
   * Not set when `executionMode` is `analysis`.
   */
  deferralReason?: string | null;
  findingsCount: number;
  workflowsDiscovered: number;
  invariantsExtracted: number;
  abuseHypothesesGenerated: number;
  specialistObservationsGenerated: number;
  specialistsCompleted: number;
  runtimeExecutionsCompleted: number;
  durationMs: number;
  /** Populated after workflow discovery (Slice 1+). */
  context?: import("./discovery/discovery.types").BusinessLogicTeamContext;
};
