export type CoreTelemetryEvent = {
  name: string;
  occurredAt: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
};

export type CoreTelemetrySink = {
  emit(event: CoreTelemetryEvent): void;
};

export type CoreTelemetryContext = {
  organizationId: string;
  projectId: string;
  scanId: string;
  executionId: string;
  correlationId: string;
};

export const noopTelemetrySink: CoreTelemetrySink = {
  emit() {},
};
