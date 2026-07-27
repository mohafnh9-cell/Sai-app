import type { BusinessLogicPlatformPayload } from "../integration/platform-payload";
import type { BusinessLogicPerformanceSnapshot } from "./performance-tracker";

export type BusinessLogicTelemetryEvent =
  | "business_logic_persist_started"
  | "business_logic_persist_completed"
  | "business_logic_persist_partial"
  | "business_logic_persist_failed"
  | "business_logic_metrics";

export type BusinessLogicOperationalMetrics = {
  workflowCount: number;
  fsmCount: number;
  invariantCount: number;
  abuseCount: number;
  runtimeDurationMs: number;
  specialistDurationMs: number;
  findingCount: number;
  coveragePercent: number;
  executionSuccessCount: number;
  executionFailureCount: number;
  specialistSuccessCount: number;
  specialistFailureCount: number;
  specialistSkippedCount: number;
  budgetEvaluationsUsed: number;
  budgetRuntimeMsUsed: number;
  budgetTransitionsUsed: number;
};

export function buildOperationalMetrics(input: {
  platform: BusinessLogicPlatformPayload;
  teamDurationMs: number;
  performance?: BusinessLogicPerformanceSnapshot | null;
}): BusinessLogicOperationalMetrics {
  const obs = input.platform.observability;
  const exec = input.platform.executionSummary;
  const specialistsCompleted = obs.specialistsCompleted;
  const specialistsFailed = obs.specialistsFailed ?? 0;
  const specialistsSkipped = obs.specialistsSkipped ?? 0;

  return {
    workflowCount: obs.workflows,
    fsmCount: obs.fsms,
    invariantCount: obs.invariants,
    abuseCount: obs.abuseCases,
    runtimeDurationMs: exec.runtimeMsUsed,
    specialistDurationMs: input.performance?.phases.specialistsMs ?? 0,
    findingCount: obs.findings,
    coveragePercent: obs.coveragePercent,
    executionSuccessCount: exec.plansCompleted,
    executionFailureCount: exec.plansFailed,
    specialistSuccessCount: specialistsCompleted,
    specialistFailureCount: specialistsFailed,
    specialistSkippedCount: specialistsSkipped,
    budgetEvaluationsUsed: exec.evaluationsUsed,
    budgetRuntimeMsUsed: exec.runtimeMsUsed,
    budgetTransitionsUsed: input.platform.observability.runtimeExecutions,
  };
}

export function emitBusinessLogicTelemetry(
  logger: { log: (entry: Record<string, unknown>) => void },
  event: BusinessLogicTelemetryEvent,
  requestId: string,
  metadata: Record<string, unknown>
): void {
  logger.log({
    event,
    requestId,
    metadata: {
      team: "business_logic",
      ...metadata,
    },
  });
}
