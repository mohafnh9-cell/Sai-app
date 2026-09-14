import "server-only";

import type { StackProfile } from "@/features/security-scanner/types";
import type { EngineCapabilityId, EngineId } from "@/server/security-engines/types";

/**
 * Phase 36: the orchestration layer ABOVE Phase 35.5's SecurityJob/worker
 * architecture. This module never executes an engine directly -- it decides
 * WHAT should run (ApplicationSurface -> SecurityPlan -> ExecutionGraph)
 * and hands execution off to server/security-jobs' SecurityJobService,
 * exactly as the brief mandates ("MCP -> Orchestrator -> spawn('trivy')" is
 * explicitly the wrong architecture).
 */

/** Section 6: generalized capabilities, not a framework-specific rule tree. */
export type ApplicationSurface = {
  stack: StackProfile;
  hasDockerfile: boolean;
  hasIacFiles: boolean;
  hasGithubActions: boolean;
  hasMcpIndicators: boolean;
  hasDependencyManifest: boolean;
  githubRepo: string | null;
  fileCount: number;
};

export type ScanDepth = "QUICK" | "STANDARD" | "DEEP" | "AUTONOMOUS";

/** Section 8: applicability != execution status. All six stay distinct end to end. */
export type EngineOutcomeStatus =
  | "NOT_APPLICABLE"
  | "SKIPPED"
  | "UNAVAILABLE"
  | "FAILED"
  | "COMPLETED_CLEAN"
  | "COMPLETED_WITH_FINDINGS";

export type PlannedEngineDecision = {
  engine: EngineId;
  selected: boolean;
  capabilities: EngineCapabilityId[];
  /** Human-readable, always present -- the plan must be inspectable/explainable (section 5). */
  rationale: string;
};

export type SecurityPlan = {
  planId: string;
  scanId: string;
  organizationId: string;
  projectId: string;
  applicationSurface: ApplicationSurface;
  depth: ScanDepth;
  decisions: PlannedEngineDecision[];
  selectedEngines: EngineId[];
  dynamicTestingAvailable: boolean;
  dynamicTestingReason: string;
  createdAt: string;
};

export type ExecutionStageId =
  | "DISCOVERY"
  | "STATIC_ANALYSIS"
  | "NORMALIZATION_CORRELATION"
  | "ATTACK_CHAIN_ANALYSIS"
  | "ADAPTIVE_INVESTIGATION"
  | "AI_REASONING"
  | "PRODUCTION_VERDICT";

export type ExecutionStage = {
  id: ExecutionStageId;
  /** Engines whose SecurityJobs this stage waits on before the NEXT stage begins -- empty for non-engine stages. */
  engines: EngineId[];
  dependsOn: ExecutionStageId[];
};

export type ExecutionGraph = {
  planId: string;
  stages: ExecutionStage[];
};

export type EngineCoverageEntry = {
  engine: EngineId;
  planned: boolean;
  applicable: boolean;
  status: EngineOutcomeStatus;
  findingsCount: number;
};

/** Section 21: this is what prevents a false "complete security" claim. */
export type CoverageReport = {
  planned: number;
  applicable: number;
  executed: number;
  clean: number;
  withFindings: number;
  failed: number;
  unavailable: number;
  skipped: number;
  entries: EngineCoverageEntry[];
};

export type OrchestratorEventType =
  | "DISCOVERY_STARTED"
  | "DISCOVERY_COMPLETED"
  | "PLAN_CREATED"
  | "JOB_QUEUED"
  | "JOB_STARTED"
  | "JOB_COMPLETED"
  | "JOB_FAILED"
  | "CORRELATION_STARTED"
  | "CORRELATION_COMPLETED"
  | "ATTACK_CHAIN_DETECTED"
  | "INVESTIGATION_STARTED"
  | "INVESTIGATION_COMPLETED"
  | "AI_REASONING_STARTED"
  | "AI_REASONING_COMPLETED"
  | "AI_REASONING_FAILED"
  | "AI_REASONING_TIMEOUT"
  | "AI_INVESTIGATION_PROPOSED"
  | "AI_INVESTIGATION_REJECTED"
  | "VERDICT_GENERATED";

export type PerformanceTelemetry = {
  discoveryDurationMs: number;
  planningDurationMs: number;
  queueLatencyMs: number;
  engineDurationMs: number;
  correlationDurationMs: number;
  attackChainDurationMs: number;
  aiReasoningDurationMs: number;
  verdictDurationMs: number;
  totalDurationMs: number;
  parallelism: number;
  engineFailures: number;
  timeouts: number;
  retries: number;
};

/** Section 13: a real, evidence-driven escalation decision, always explained either way. */
export type InvestigationDecision = {
  triggerFindingId: string;
  triggerReason: string;
  escalated: boolean;
  reason: string;
};
