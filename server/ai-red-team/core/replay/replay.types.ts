import type { CoreUniqueId } from "../contracts/identifiers";

export type CoreReplayStep = {
  id: CoreUniqueId;
  order: number;
  kind: string;
  label: string;
  nodeId: CoreUniqueId | null;
};

export type CoreReplaySequence = {
  id: CoreUniqueId;
  steps: CoreReplayStep[];
};

export type CoreReplayEvidence = {
  id: CoreUniqueId;
  detail: string;
  refId: CoreUniqueId | null;
};

export type CoreReplayMetadata = {
  generatedAt: string;
  executable: boolean;
  expectedOutcome: string;
};

export type CoreReplayPlan = {
  id: CoreUniqueId;
  findingId: CoreUniqueId;
  sequence: CoreReplaySequence;
  expectedEvidence: CoreReplayEvidence[];
  metadata: CoreReplayMetadata;
};

export type CoreReplayContext = {
  runId: CoreUniqueId;
  organizationId: string;
  projectId: string;
};

export type CoreReplayValidatorContract = {
  validate(plan: CoreReplayPlan): { valid: boolean; issues: string[] };
};

export type CoreReplayBudget = {
  maxSteps: number;
  maxDurationMs: number;
};
