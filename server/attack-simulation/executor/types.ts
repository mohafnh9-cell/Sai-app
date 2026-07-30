import type { AttackExecutionStatus } from "../contracts/enums";
import type { AttackExecution } from "../contracts/attack-execution";
import type { SafeRuntimeSession } from "../runtime/safe-runtime";
import type { AttackExecutionStep, AttackExecutionStepStatus } from "../contracts/attack-execution-step";
import type { AttackScenario } from "../contracts/attack-scenario";
import type { AttackCampaign } from "../contracts/attack-campaign";
import type { SafeRuntimeStepResult } from "../runtime/types";

export type AttackExecutionStepRun = Pick<
  AttackExecutionStep,
  "id" | "kind" | "label" | "sortOrder" | "weight" | "status"
>;

export type AttackExecutionStepRunResult = {
  stepId: string;
  stepKind: string;
  stepStatus: AttackExecutionStepStatus;
  runtimeResult: SafeRuntimeStepResult;
  startedAtMs: number;
  completedAtMs: number;
};

export type AttackExecutionRunOutcome =
  | {
      ok: true;
      terminalStatus: AttackExecutionStatus;
      stepResults: AttackExecutionStepRunResult[];
      skippedSteps: number;
      session: SafeRuntimeSession;
    }
  | {
      ok: false;
      terminalStatus: AttackExecutionStatus;
      failureCode: string;
      safeFailureMessage: string;
      stepResults: AttackExecutionStepRunResult[];
      session: SafeRuntimeSession;
    };

export type AttackExecutionRunContext = {
  campaign: Pick<
    AttackCampaign,
    "id" | "organizationId" | "projectId" | "commitSha" | "runtimeMode" | "correlationId" | "status"
  >;
  execution: Pick<
    AttackExecution,
    | "id"
    | "campaignId"
    | "scenarioId"
    | "organizationId"
    | "projectId"
    | "commitSha"
    | "runtimeMode"
    | "correlationId"
    | "status"
    | "attackerProfile"
  >;
  scenario: Pick<AttackScenario, "id" | "adapterId" | "metadata">;
  steps: AttackExecutionStepRun[];
};

export type AttackExecutionRunSignal = {
  cancelled?: boolean;
  emergencyStop?: boolean;
};

export const ATTACK_EXECUTION_ORG_CONCURRENCY_LIMIT = 2;
export const ATTACK_EXECUTION_TIMEOUT_MS = 15 * 60 * 1000;
