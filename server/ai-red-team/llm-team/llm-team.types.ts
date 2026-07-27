import type { AttackPlan } from "../types";
import type { DiscoveryReport } from "../discovery/types";
import type { AIFindingCollection } from "./findings/finding.types";
import type { AIAttackCollection } from "./attacks/attack.types";
import type { AIInvariantCollection } from "./invariants/invariant.types";
import type { AIExecutionGraph } from "./model/execution-graph.types";
import type { AiDiscoveryInventory } from "./discovery/discovery.types";
import type { AISpecialistExecutionSummary } from "./specialists/specialist.types";
import type { AIRuntimeSummary } from "./runtime/runtime.types";

export type LlmTeamAttackContext = {
  discovery: DiscoveryReport;
  plan: AttackPlan;
  redTeamRunId?: string;
};

export type LlmTeamInput = {
  organizationId: string;
  projectId: string;
  runId: string;
  requestId: string;
  discoveryReport: DiscoveryReport;
  plan: AttackPlan;
  signal?: AbortSignal;
};

export type LlmTeamRunStatus = "completed" | "skipped" | "failed";

export type LlmTeamResult = {
  llmTeamRunId: string;
  status: LlmTeamRunStatus;
  skippedReason?: string | null;
  deferralReason?: string | null;
  analysisPhase: string;
  executionMode: string;
  findingsCount: number;
  graphNodeCount: number;
  graphEdgeCount: number;
  trustBoundaryCount: number;
  invariantsExtracted: number;
  attackCasesGenerated: number;
  specialistsCompleted: number;
  specialistsSkipped: number;
  specialistsFailed: number;
  runtimeExecutionsCompleted: number;
  runtimeFailures: number;
  durationMs: number;
  inventory?: AiDiscoveryInventory;
  graph?: AIExecutionGraph;
  invariants?: AIInvariantCollection;
  attacks?: AIAttackCollection;
  specialistSummary?: AISpecialistExecutionSummary;
  runtimeSummary?: AIRuntimeSummary;
  findings?: AIFindingCollection;
};
