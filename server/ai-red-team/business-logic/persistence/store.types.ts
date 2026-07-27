import type { BusinessLogicTeamResult } from "../business-logic.types";

export const BUSINESS_LOGIC_PERSISTENCE_SCHEMA_VERSION = 1;

export type BusinessLogicRunRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  redTeamRunId: string | null;
  scanJobId: string | null;
  idempotencyKey: string | null;
  schemaVersion: number;
  status: string;
  analysisPhase: string;
  executionMode: string;
  commitSha: string | null;
  workflowCount: number;
  fsmCount: number;
  invariantCount: number;
  abuseCaseCount: number;
  findingsCount: number;
  specialistsCompleted: number;
  specialistsSkipped: number;
  specialistsFailed: number;
  runtimeExecutionsCompleted: number;
  runtimeExecutionsFailed: number;
  coveragePercent: number | null;
  durationMs: number;
  partialPersistence: boolean;
  observability: Record<string, unknown>;
  executionMetadata: Record<string, unknown>;
  startedAt: string | null;
  completedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type BusinessLogicPersistArtifacts = {
  workflows: Array<{
    workflowId: string;
    kind: string;
    label: string;
    confidence: number;
    payload: Record<string, unknown>;
  }>;
  stateMachines: Array<{
    workflowId: string;
    stateMachineId: string;
    payload: Record<string, unknown>;
  }>;
  invariants: Array<{
    invariantId: string;
    workflowId: string | null;
    payload: Record<string, unknown>;
  }>;
  abuseCases: Array<{
    abuseCaseId: string;
    workflowId: string | null;
    payload: Record<string, unknown>;
  }>;
  specialistResults: Array<{
    specialistId: string;
    status: string;
    durationMs: number;
    observationCount: number;
    payload: Record<string, unknown>;
  }>;
  runtimeResults: Array<{
    executionId: string;
    specialistId: string;
    workflowId: string;
    status: string;
    durationMs: number;
    payload: Record<string, unknown>;
  }>;
  findings: Array<{
    findingId: string;
    workflowId: string;
    severity: string;
    status: string;
    confidence: string;
    payload: Record<string, unknown>;
  }>;
  replayPlans: Array<{
    replayPlanId: string;
    findingId: string;
    executable: boolean;
    payload: Record<string, unknown>;
  }>;
};

export type PersistBusinessLogicRunInput = {
  result: BusinessLogicTeamResult;
  organizationId: string;
  projectId: string;
  redTeamRunId?: string | null;
  scanJobId?: string | null;
  idempotencyKey?: string | null;
  startedAtIso?: string;
  completedAtIso?: string;
  /** When true, only header + completed sections are written (interrupted run). */
  partial?: boolean;
  revisionReason?: string | null;
};

export type PersistBusinessLogicRunOutcome = {
  runId: string;
  revision: number;
  persisted: boolean;
  partialPersistence: boolean;
  counts: {
    workflows: number;
    fsms: number;
    invariants: number;
    abuseCases: number;
    specialists: number;
    runtimeResults: number;
    findings: number;
    replayPlans: number;
  };
};

export interface BusinessLogicRunStore {
  findByIdempotency(
    projectId: string,
    idempotencyKey: string
  ): Promise<BusinessLogicRunRecord | null>;

  getRun(runId: string): Promise<BusinessLogicRunRecord | null>;

  persistRun(input: {
    header: Omit<BusinessLogicRunRecord, "createdAt" | "updatedAt">;
    artifacts: BusinessLogicPersistArtifacts;
    revisionReason?: string | null;
  }): Promise<PersistBusinessLogicRunOutcome>;
}
