import type { CanonicalPipelineStageId } from "../canonical-stages";

export type PipelineStageExecutionMode = "required" | "optional" | "skip_if_unsupported";

export type PipelineStageRetryPolicy = {
  maxAttempts: number;
  backoffMs: number;
};

export type PipelineStageDefinition = {
  id: CanonicalPipelineStageId;
  name: string;
  version: { major: number; minor: number; patch: number };
  inputs: string[];
  outputs: string[];
  requiredCapabilities: string[];
  optionalCapabilities: string[];
  executionMode: PipelineStageExecutionMode;
  estimatedCostMs: number;
  priority: number;
  retryPolicy: PipelineStageRetryPolicy;
  metadata: Record<string, unknown>;
};

export type PipelineDefinition = {
  id: string;
  version: string;
  manifestId: string;
  stages: PipelineStageDefinition[];
  metadata: Record<string, unknown>;
};

export type PipelineCapabilities = {
  required: string[];
  optional: string[];
};

export type PipelineMetadata = {
  plannedAt: string;
  manifestId: string;
  manifestVersion: string;
  stageCount: number;
  skippedStages: string[];
  reusedArtifacts: string[];
  explainability: string[];
};

export type PipelineStageResult = {
  stageId: CanonicalPipelineStageId;
  status: "completed" | "skipped" | "failed";
  durationMs: number;
  skipReason?: string;
  outputs?: Record<string, unknown>;
  reused?: boolean;
};

export type PipelineResult = {
  status: "completed" | "partial" | "failed" | "skipped";
  stageResults: PipelineStageResult[];
  context: PipelineContext;
  metadata: PipelineMetadata;
  durationMs: number;
};

export type PipelineContext = {
  runId: string;
  requestId: string;
  organizationId: string;
  projectId: string;
  signal?: AbortSignal;
  artifacts: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export type PipelineStageOutcome = {
  status: "completed" | "skipped" | "failed";
  outputs?: Record<string, unknown>;
  skipReason?: string;
  reuseExisting?: boolean;
};

export type PipelineStageHandler = (
  context: PipelineContext
) => Promise<PipelineStageOutcome>;

export type PipelineStageHandlers = Partial<Record<CanonicalPipelineStageId, PipelineStageHandler>>;

export type PipelineExecutorOptions = {
  reuseArtifacts?: boolean;
  mergeCompatibleExecutions?: boolean;
};

export type PipelineExecuteInput = {
  context: PipelineContext;
};
