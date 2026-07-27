export type RtCoreErrorCode =
  | "ValidationError"
  | "CapabilityResolutionError"
  | "ManifestError"
  | "PipelinePlanningError"
  | "StageExecutionError"
  | "BudgetExceededError"
  | "RuntimeSafetyError"
  | "SerializationError"
  | "PersistenceError"
  | "IntegrationError"
  | "UnsupportedOperationError";

export type RtCoreErrorSeverity = "info" | "warning" | "error" | "critical";

export type RtCoreError = {
  code: RtCoreErrorCode;
  stableCode: string;
  message: string;
  internalCause?: string;
  stage?: string;
  retryable: boolean;
  severity: RtCoreErrorSeverity;
  correlationId?: string;
  metadata?: Record<string, unknown>;
};

export function createRtCoreError(input: {
  code: RtCoreErrorCode;
  stableCode: string;
  message: string;
  internalCause?: string;
  stage?: string;
  retryable?: boolean;
  severity?: RtCoreErrorSeverity;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}): RtCoreError {
  return {
    code: input.code,
    stableCode: input.stableCode,
    message: input.message,
    internalCause: input.internalCause,
    stage: input.stage,
    retryable: input.retryable ?? false,
    severity: input.severity ?? "error",
    correlationId: input.correlationId,
    metadata: input.metadata,
  };
}

export function toSafeErrorPayload(error: RtCoreError): RtCoreError {
  return {
    ...error,
    internalCause: undefined,
    metadata: error.metadata
      ? Object.fromEntries(
          Object.entries(error.metadata).filter(
            ([k]) => !["prompt", "token", "secret", "credential", "payload"].includes(k.toLowerCase())
          )
        )
      : undefined,
  };
}
